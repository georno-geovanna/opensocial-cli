// Demo adapter — mock data so `social sync demo timeline` runs with zero credentials.
// Shows the full engine end to end (paging, cursor, write-through, sql). Two pages.
import { isoToEpochMs, stringifyJSON } from "../sqlsync/collection.mjs"

const PAGE = {
  "": {
    data: [
      { id: "1", author: "levelsio", text: "just shipped another thing", public_metrics: { like_count: 4200 }, created_at: "2026-07-01T10:00:00Z" },
      { id: "2", author: "swyx", text: "the rise of the agent-native CLI", public_metrics: { like_count: 980 }, created_at: "2026-07-02T09:00:00Z" },
      { id: "3", author: "rauchg", text: "local-first is underrated", public_metrics: { like_count: 3100 }, created_at: "2026-07-03T14:00:00Z" },
    ],
    meta: { next_token: "p2" },
  },
  p2: {
    data: [
      { id: "4", author: "karpathy", text: "software 3.0 is prompts + tools", public_metrics: { like_count: 15000 }, created_at: "2026-07-04T18:00:00Z" },
      { id: "5", author: "dhh", text: "no build step, ship it", public_metrics: { like_count: 2200 }, created_at: "2026-07-05T08:00:00Z" },
    ],
    meta: {},
  },
}

// api shim matching the engine's api.get(path, query) -> {status, headers, json()}
export const demoApi = {
  get: async (_path, query) => {
    const token = query?.pagination_token ?? ""
    const body = PAGE[token] ?? { data: [], meta: {} }
    return { status: 200, headers: {}, json: async () => body }
  },
}

export const collections = {
  timeline: {
    key: "demo_timeline",
    table: "demo_timeline",
    columns: ["id", "author", "text", "likes", "created_at", "raw"],
    supportsSince: true,
    pagination: { itemsPath: "data", cursorPath: "meta.next_token" },
    request: ({ cursor }) => ({
      path: "/2/timeline",
      query: { max_results: "100", ...(cursor ? { pagination_token: cursor } : {}) },
    }),
    normalize: (raw) => ({
      id: String(raw.id),
      author: raw.author ?? null,
      text: raw.text ?? null,
      likes: raw.public_metrics?.like_count ?? 0,
      created_at: isoToEpochMs(raw.created_at),
      raw: stringifyJSON(raw),
    }),
  },
}
