// Thin wrapper over Node's built-in node:sqlite (Node >=22.5).
// SQL uses colon placeholders (`:id`); callers bind bare object keys ({ id: value }).
// Booleans normalize to 0/1 and undefined to NULL so one query path works everywhere.
import { DatabaseSync } from "node:sqlite"

const normalizeParams = (params) => {
  if (!params) return undefined
  const out = {}
  for (const [k, v] of Object.entries(params)) {
    out[k] = v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v
  }
  return out
}

export function openDB(path) {
  const db = new DatabaseSync(path)
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const stmt = db.prepare(sql)
      return {
        run: (params) => stmt.run(normalizeParams(params) ?? {}),
        get: (params) => stmt.get(normalizeParams(params) ?? {}),
        all: (params) => stmt.all(normalizeParams(params) ?? {}),
      }
    },
    transaction: (fn) => {
      db.exec("BEGIN")
      try {
        fn()
        db.exec("COMMIT")
      } catch (e) {
        db.exec("ROLLBACK")
        throw e
      }
    },
    close: () => db.close(),
  }
}
