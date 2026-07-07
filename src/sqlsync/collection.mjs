// A Collection is a syncable resource: how to page the upstream API, and how to
// turn each raw item into a flat SQLite row. Adapters (x, linkedin, demo) export
// a map of these. (Reconstruction of @usesocial/sqlsync's Collection contract.)

/**
 * @typedef {Object} Collection
 * @property {string} key            table/collection key, e.g. "x_tweets"
 * @property {string} table          SQLite table name
 * @property {string[]} columns      column names (id first)
 * @property {(ctx:{cursor:string,since:number|null,ownId:string}) => {path:string, query:Record<string,string>}} request
 *           builds the next page request from the resume cursor
 * @property {Object} pagination     { itemsPath, cursorPath }  (dot-paths into the envelope)
 * @property {(raw:object) => object} normalize  raw item -> row (must include `id`)
 * @property {boolean} [supportsSince]
 */

export const readPath = (obj, path) =>
  path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj)

export const isoToEpochMs = (v) => {
  if (v == null) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

export const stringifyJSON = (v) => (v == null ? null : JSON.stringify(v))

// Every content table carries two engine-owned columns (matching @usesocial's
// convention): `synced_at` = mirror timestamp (epoch ms), and `raw` = full JSON of
// the source object so `sql` can reach fields the adapter didn't flatten and the
// mirror survives provider schema drift. Adapters supply `raw` in normalize();
// the engine always stamps `synced_at`.
export const allColumns = (c) => [...c.columns, ...(c.columns.includes("synced_at") ? [] : ["synced_at"])]

// Build a CREATE TABLE from a collection's columns. `id` is the primary key so
// re-syncing upserts instead of duplicating (write-through / idempotent sync).
export function createTableSQL(c) {
  const cols = allColumns(c)
    .map((col) => (col === "id" ? "id TEXT PRIMARY KEY" : col === "synced_at" ? "synced_at INTEGER NOT NULL" : `${col} `))
    .join(", ")
  return `CREATE TABLE IF NOT EXISTS ${c.table} (${cols})`
}

export function upsertSQL(c) {
  const cols = allColumns(c)
  const placeholders = cols.map((col) => `:${col}`).join(", ")
  const updates = cols.filter((col) => col !== "id").map((col) => `${col}=excluded.${col}`).join(", ")
  return `INSERT INTO ${c.table} (${cols.join(", ")}) VALUES (${placeholders})
          ON CONFLICT(id) DO UPDATE SET ${updates}`
}
