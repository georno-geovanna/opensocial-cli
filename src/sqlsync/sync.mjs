// The sync engine. For a collection it: plans (full vs --since incremental),
// walks upstream pages resuming from a stored partial cursor, write-throughs each
// page's rows into SQLite inside a transaction, checkpoints the cursor after every
// page (so an interrupted sync resumes exactly), paces requests, and retries on
// rate-limit. Clean-room reconstruction of @usesocial/sqlsync's sync loop.
import { readPath, createTableSQL, upsertSQL } from "./collection.mjs"
import { encodePartialSyncCursor, parsePartialSyncCursor, newCursor } from "./cursor.mjs"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function ensureStateTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS sync_state (
    collection TEXT PRIMARY KEY,
    partial_cursor TEXT,
    newest_id TEXT,
    last_synced INTEGER,
    object_count INTEGER DEFAULT 0
  )`)
}

function loadState(db, key) {
  return db.prepare("SELECT * FROM sync_state WHERE collection = :k").get({ k: key })
}

function saveState(db, key, { partialCursor, newestId, lastSynced, objectCount }) {
  db.prepare(`INSERT INTO sync_state (collection, partial_cursor, newest_id, last_synced, object_count)
    VALUES (:collection, :partial_cursor, :newest_id, :last_synced, :object_count)
    ON CONFLICT(collection) DO UPDATE SET
      partial_cursor=excluded.partial_cursor, newest_id=excluded.newest_id,
      last_synced=excluded.last_synced, object_count=excluded.object_count`).run({
    collection: key,
    partial_cursor: partialCursor,
    newest_id: newestId,
    last_synced: lastSynced,
    object_count: objectCount,
  })
}

/**
 * @param {object} deps  { db, api, ownId, pageDelayMs?, maxPages?, onProgress? }
 * @param {import("./collection.mjs").Collection} collection
 * @param {{ since?: number|null }} [opts]
 */
export async function syncCollection(deps, collection, opts = {}) {
  const { db, api, ownId = "me", pageDelayMs = 0, maxPages = Infinity, onProgress } = deps
  const since = opts.since ?? null

  if (since != null && !collection.supportsSince)
    throw new Error(`Collection ${collection.key} does not support --since`)

  ensureStateTable(db)
  db.exec(createTableSQL(collection))
  const upsert = db.prepare(upsertSQL(collection))

  // Resume from a stored partial cursor if present, else start fresh.
  const prior = loadState(db, collection.key)
  let cursorState = newCursor(since)
  if (prior?.partial_cursor) {
    const parsed = parsePartialSyncCursor(prior.partial_cursor)
    if (parsed.ok) cursorState = parsed.value
    else throw new Error(`Invalid partial cursor for ${collection.key}: ${parsed.reason}`)
  }
  let newestId = prior?.newest_id ?? null
  let objectCount = prior?.object_count ?? 0

  let pages = 0
  let upserted = 0
  let stopReason = "exhausted"

  while (pages < maxPages) {
    const { path, query } = collection.request({ cursor: cursorState.cursor, since, ownId })

    // rate-limit aware fetch with bounded retry
    let envelope
    for (let attempt = 0; ; attempt++) {
      const res = await api.get(path, query)
      if (res.status === 429 && attempt < 5) {
        const wait = Number(res.headers?.["retry-after"] ?? 2 ** attempt) * 1000
        onProgress?.({ collectionKey: collection.key, event: "rate-limit", waitMs: wait })
        await sleep(wait)
        continue
      }
      if (res.status >= 400) throw new Error(`${collection.key}: upstream ${res.status}`)
      envelope = await res.json()
      break
    }

    const items = readPath(envelope, collection.pagination.itemsPath) ?? []
    const nextCursor = readPath(envelope, collection.pagination.cursorPath) ?? ""

    const syncedAt = Date.now()
    db.transaction(() => {
      for (const raw of items) {
        const row = { ...collection.normalize(raw), synced_at: syncedAt }
        upsert.run(row)
        upserted++
        objectCount++
        if (newestId == null && row.id != null) newestId = String(row.id)
      }
    })

    pages++
    cursorState = { ...cursorState, cursor: nextCursor, newestId, requestIndex: cursorState.requestIndex }

    // checkpoint after every page -> interrupted sync resumes exactly here
    saveState(db, collection.key, {
      partialCursor: nextCursor ? encodePartialSyncCursor(cursorState) : null,
      newestId,
      lastSynced: Date.now(),
      objectCount,
    })
    onProgress?.({ collectionKey: collection.key, event: "page", pages, upserted, hasMore: !!nextCursor })

    if (!nextCursor) break
    if (pages >= maxPages) { stopReason = "page-limit"; break }
    if (pageDelayMs) await sleep(typeof pageDelayMs === "function" ? pageDelayMs(pages) : pageDelayMs)
  }

  return { collectionKey: collection.key, pages, upserted, objectCount, newestId, stopReason }
}
