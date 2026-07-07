// Resumable partial-sync cursor. A sync can be interrupted mid-collection and
// resumed exactly where it stopped. Encoded as `partial-sync-v1:{json}` and stored
// in the sync_state table alongside each collection's high-water mark.
// (Reconstruction of @usesocial/sqlsync's PartialSyncCursor design.)
export const PARTIAL_SYNC_CURSOR_PREFIX = "partial-sync-v1:"

/**
 * @typedef {Object} PartialSyncCursor
 * @property {1} version
 * @property {number} requestIndex   index into the collection's request list
 * @property {string} cursor         upstream pagination token to resume from
 * @property {string|null} checkpoint opaque per-collection checkpoint
 * @property {string|null} newestId  newest object id seen (incremental high-water mark)
 * @property {number|null} since     epoch ms of the --since bound, if any
 */

export const encodePartialSyncCursor = (c) =>
  `${PARTIAL_SYNC_CURSOR_PREFIX}${JSON.stringify(c)}`

const valid = (v) =>
  v &&
  v.version === 1 &&
  Number.isInteger(v.requestIndex) &&
  v.requestIndex >= 0 &&
  typeof v.cursor === "string" &&
  (typeof v.checkpoint === "string" || v.checkpoint === null) &&
  (typeof v.newestId === "string" || v.newestId === null) &&
  (typeof v.since === "number" || v.since === null)

/** @returns {{ok:true,value:PartialSyncCursor}|{ok:false,reason:string}} */
export function parsePartialSyncCursor(value) {
  if (typeof value !== "string" || !value.startsWith(PARTIAL_SYNC_CURSOR_PREFIX))
    return { ok: false, reason: "missing partial-sync-v1 prefix" }
  try {
    const parsed = JSON.parse(value.slice(PARTIAL_SYNC_CURSOR_PREFIX.length))
    if (valid(parsed)) return { ok: true, value: parsed }
    return { ok: false, reason: "payload does not match the partial cursor shape" }
  } catch (e) {
    return { ok: false, reason: "payload is not valid JSON" }
  }
}

export const newCursor = (since = null) => ({
  version: 1,
  requestIndex: 0,
  cursor: "",
  checkpoint: null,
  newestId: null,
  since,
})
