// opensocial CLI — agent-first: compact JSON on stdout, machine-readable `schema`,
// deterministic exit codes, tagged errors on stderr. Reconstruction of the
// @usesocial/cli surface, bring-your-own-keys, no hosted backend.
import { homedir } from "node:os"
import { join } from "node:path"
import { mkdirSync, existsSync } from "node:fs"
import { openDB } from "./sqlsync/sqlite.mjs"
import { syncCollection } from "./sqlsync/sync.mjs"
import * as demo from "./adapters/demo.mjs"
import * as x from "./adapters/x.mjs"
import * as linkedin from "./adapters/linkedin.mjs"

const HOME = join(homedir(), ".social")
const DB_PATH = process.env.SOCIAL_DB ?? join(HOME, "social.db")

const ADAPTERS = {
  demo: { collections: demo.collections, api: () => demo.demoApi, ownId: () => "demo" },
  x: { collections: x.collections, api: () => x.xApi(), ownId: () => process.env.SOCIAL_X_USER_ID ?? "me" },
  linkedin: { collections: linkedin.collections, api: () => linkedin.linkedinApi(), ownId: () => process.env.SOCIAL_LI_ACCOUNT ?? "me" },
}

const out = (obj) => process.stdout.write(JSON.stringify(obj) + "\n")
const fail = (code, error, extra = {}) => {
  process.stderr.write(JSON.stringify({ ok: false, error, ...extra }) + "\n")
  process.exit(code)
}

function db() {
  mkdirSync(HOME, { recursive: true })
  return openDB(DB_PATH)
}

// Read-only connection for `sql` — SQLite rejects writes at the engine level.
function readonlyDb() {
  if (!existsSync(DB_PATH)) return null
  return openDB(DB_PATH, { readOnly: true })
}

const SCHEMA = {
  name: "social",
  version: "0.1.0",
  description: "Mirror LinkedIn & X into local SQLite; query it from any shell.",
  commands: {
    sync: { usage: "social sync <adapter> <collection> [--since ISO] [--max-pages N]", desc: "Pull a collection into local SQLite (incremental with --since)." },
    sql: { usage: "social sql \"<query>\"", desc: "Run a read-only SQL query over the local mirror. JSON rows on stdout." },
    schema: { usage: "social schema", desc: "Emit this machine-readable command + adapter tree as JSON." },
    adapters: { usage: "social adapters", desc: "List available adapters and their collections." },
    login: { usage: "social login <adapter>", desc: "How to provide credentials (bring-your-own-keys)." },
  },
  adapters: {
    demo: { collections: Object.keys(demo.collections), auth: "none" },
    x: {
      collections: Object.keys(x.collections),
      modes: {
        v2: "SOCIAL_X_BEARER + SOCIAL_X_USER_ID (official X API v2)",
        cookie: "SOCIAL_X_AUTH_TOKEN + SOCIAL_X_CT0 (free reverse-engineered GraphQL; tweets only)",
      },
    },
    linkedin: {
      collections: Object.keys(linkedin.collections),
      modes: {
        unipile: "SOCIAL_LI_MODE=unipile + SOCIAL_UNIPILE_URL + SOCIAL_UNIPILE_KEY + SOCIAL_LI_ACCOUNT (reliable)",
        voyager: "SOCIAL_LI_MODE=voyager + SOCIAL_LI_AT + SOCIAL_LI_CSRF (free/DIY, fragile, ban-prone)",
      },
    },
  },
  proxy: "Optional HTTPS_PROXY routes upstream calls through your own residential IP (bring-your-own; no fleet shipped).",
}

function parseFlags(args) {
  const flags = {}
  const rest = []
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2)
      flags[key] = args[i + 1]?.startsWith("--") || args[i + 1] === undefined ? true : args[++i]
    } else rest.push(args[i])
  }
  return { flags, rest }
}

function parseSince(v) {
  if (v == null || v === true) return null
  const t = Date.parse(String(v).length === 10 ? `${v}T00:00:00Z` : v)
  if (Number.isNaN(t)) fail(2, "InvalidSince", { message: "Use ISO like 2026-07-01 or 2026-07-01T00:00:00Z" })
  return t
}

export async function main(argv) {
  const [cmd, ...args] = argv
  const { flags, rest } = parseFlags(args)

  if (!cmd || cmd === "help" || flags.help) return out(SCHEMA)
  if (cmd === "schema") return out(SCHEMA)
  if (cmd === "adapters") return out({ ok: true, adapters: SCHEMA.adapters })

  if (cmd === "login") {
    const a = rest[0]
    if (a === "x") return out({ ok: true, adapter: "x", instructions: "export SOCIAL_X_BEARER=<your X API v2 bearer>; export SOCIAL_X_USER_ID=<your numeric id>" })
    return out({ ok: true, note: "Bring-your-own-keys. See `social adapters` for each adapter's env vars." })
  }

  if (cmd === "sync") {
    const [adapterName, collName] = rest
    const adapter = ADAPTERS[adapterName]
    if (!adapter) return fail(2, "UnknownAdapter", { adapter: adapterName, known: Object.keys(ADAPTERS) })
    const collection = adapter.collections[collName]
    if (!collection) return fail(2, "UnknownCollection", { adapter: adapterName, collection: collName, known: Object.keys(adapter.collections) })
    const since = parseSince(flags.since)
    const maxPages = flags["max-pages"] ? Number(flags["max-pages"]) : Infinity
    const database = db()
    try {
      const result = await syncCollection(
        { db: database, api: adapter.api(), ownId: adapter.ownId(), maxPages, pageDelayMs: adapterName === "x" ? 300 : 0 },
        collection,
        { since }
      )
      return out({ ok: true, ...result })
    } catch (e) {
      return fail(1, "SyncFailed", { collection: collName, message: String(e.message ?? e) })
    } finally {
      database.close()
    }
  }

  if (cmd === "sql") {
    const query = rest.join(" ")
    if (!query) return fail(2, "MissingQuery", { usage: "social sql \"select ...\"" })
    if (!/^\s*(select|with|explain)\b/i.test(query)) return fail(2, "ReadOnly", { message: "sql is read-only (select/with/explain)" })
    const database = readonlyDb()
    if (!database) return fail(1, "NoData", { message: "No local mirror yet — run `social sync <adapter> <collection>` first." })
    try {
      const rows = database.prepare(query).all()
      return out({ ok: true, rowCount: rows.length, rows })
    } catch (e) {
      return fail(1, "QueryFailed", { message: String(e.message ?? e) })
    } finally {
      database.close()
    }
  }

  return fail(2, "UnknownCommand", { command: cmd, commands: Object.keys(SCHEMA.commands) })
}
