// Fixture dry-run: exercises the REAL x + linkedin adapters (request build + normalize
// + write-through + read-only sql) against canned responses, no network, no real creds.
// Also asserts every upstream call is a GET (read-only holds on the real sync path).
// Run: node test/fixtures.mjs
import assert from "node:assert"
import { openDB } from "../src/sqlsync/sqlite.mjs"
import { syncCollection } from "../src/sqlsync/sync.mjs"
import { proxyFetch } from "../src/adapters/_http.mjs"
import * as x from "../src/adapters/x.mjs"
import * as linkedin from "../src/adapters/linkedin.mjs"

const methods = []
function stubFetch(payload) {
  globalThis.fetch = async (_url, opts = {}) => {
    methods.push((opts.method ?? "GET").toUpperCase())
    return { status: 200, headers: new Map(), json: async () => payload }
  }
}
const mem = () => openDB(":memory:")
let pass = 0
const ok = (name) => { console.log("  ✓", name); pass++ }

// ---- 1. read-only guard holds on the real provider path (proxyFetch forces GET) ----
{
  stubFetch({})
  await proxyFetch("https://api.x.com/2/x", {})            // GET
  await proxyFetch("https://api.x.com/2/x", { method: "get" })
  let threw = false
  try { await proxyFetch("https://api.x.com/2/x", { method: "POST" }) } catch { threw = true }
  assert.ok(threw, "POST must throw")
  assert.ok(methods.every((m) => m === "GET"), "only GET reached the network")
  ok("read-only chokepoint: GET allowed, POST refused, network saw only GET")
}

// ---- 2. real X adapter (v2 mode): request -> normalize -> SQLite -> sql ----
{
  process.env.SOCIAL_X_BEARER = "test-bearer"
  process.env.SOCIAL_X_USER_ID = "123"
  methods.length = 0
  stubFetch({
    data: [
      { id: "9001", author_id: "123", text: "hello", public_metrics: { like_count: 12, impression_count: 900 }, lang: "en", created_at: "2026-07-01T00:00:00Z" },
    ],
    meta: {}, // no next_token -> one page
  })
  const db = mem()
  const r = await syncCollection({ db, api: x.xApi(), ownId: "123" }, x.collections.tweets, {})
  assert.equal(r.upserted, 1)
  const row = db.prepare("SELECT id, text, likes, impressions, synced_at FROM x_tweets").get()
  assert.equal(row.id, "9001"); assert.equal(row.likes, 12); assert.equal(row.impressions, 900)
  assert.ok(row.synced_at > 0, "synced_at stamped")
  assert.ok(methods.every((m) => m === "GET"), "x sync only issued GETs")
  ok("x adapter (v2): sync -> normalized row -> read-only readback, GET-only")
}

// ---- 3. real LinkedIn adapter (unipile mode): request -> normalize -> SQLite ----
{
  process.env.SOCIAL_LI_MODE = "unipile"
  process.env.SOCIAL_UNIPILE_URL = "https://api.unipile.test"
  process.env.SOCIAL_UNIPILE_KEY = "test-key"
  process.env.SOCIAL_LI_ACCOUNT = "acc1"
  methods.length = 0
  stubFetch({
    items: [{ id: "li_1", first_name: "Ada", last_name: "Lovelace", headline: "Analyst", connected_at: "2026-06-01T00:00:00Z" }],
    cursor: null,
  })
  const db = mem()
  const r = await syncCollection({ db, api: linkedin.linkedinApi(), ownId: "acc1" }, linkedin.collections.connections, {})
  assert.equal(r.upserted, 1)
  const row = db.prepare("SELECT id, name, headline FROM li_connections").get()
  assert.equal(row.id, "li_1"); assert.equal(row.name, "Ada Lovelace"); assert.equal(row.headline, "Analyst")
  assert.ok(methods.every((m) => m === "GET"), "linkedin sync only issued GETs")
  ok("linkedin adapter (unipile): sync -> normalized row, GET-only")
}

// ---- 4. --since rejected where unsupported (followers) ----
{
  process.env.SOCIAL_X_BEARER = "test-bearer"
  stubFetch({ data: [], meta: {} })
  let threw = false
  try { await syncCollection({ db: mem(), api: x.xApi(), ownId: "1" }, x.collections.followers, { since: Date.now() }) } catch { threw = true }
  assert.ok(threw, "--since must be rejected for followers")
  ok("since-unsupported guard fires")
}

console.log(`\n${pass}/4 fixture checks passed — real adapter paths verified, read-only holds.`)
