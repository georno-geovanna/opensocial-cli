// X (Twitter) adapter — real X API v2, bring-your-own bearer token (SOCIAL_X_BEARER).
// No middleman backend, no markup: you call X directly with your own app credentials.
// Mirrors @usesocial/cli's X collection shape (cursor pagination, field expansions).
import { isoToEpochMs, stringifyJSON } from "../sqlsync/collection.mjs"

const BASE = "https://api.x.com"

const TWEET_FIELDS = "created_at,public_metrics,lang,conversation_id,in_reply_to_user_id,referenced_tweets,entities"
const USER_FIELDS = "created_at,public_metrics,description,location,verified,username,name"

export function xApi(bearer = process.env.SOCIAL_X_BEARER) {
  return {
    get: async (path, query) => {
      if (!bearer) throw new Error("Set SOCIAL_X_BEARER to your X API v2 bearer token")
      const url = new URL(BASE + path)
      for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v)
      const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` } })
      return {
        status: res.status,
        headers: { "retry-after": res.headers.get("x-rate-limit-reset-after") ?? res.headers.get("retry-after") },
        json: () => res.json(),
      }
    },
  }
}

export const collections = {
  // Your own recent posts. `ownId` is your numeric X user id (SOCIAL_X_USER_ID).
  tweets: {
    key: "x_tweets",
    table: "x_tweets",
    columns: ["id", "author_id", "text", "likes", "retweets", "replies", "impressions", "lang", "created_at", "raw"],
    supportsSince: true,
    pagination: { itemsPath: "data", cursorPath: "meta.next_token" },
    request: ({ cursor, ownId }) => ({
      path: `/2/users/${ownId}/tweets`,
      query: {
        max_results: "100",
        "tweet.fields": TWEET_FIELDS,
        ...(cursor ? { pagination_token: cursor } : {}),
      },
    }),
    normalize: (raw) => ({
      id: String(raw.id),
      author_id: raw.author_id ?? null,
      text: raw.text ?? null,
      likes: raw.public_metrics?.like_count ?? 0,
      retweets: raw.public_metrics?.retweet_count ?? 0,
      replies: raw.public_metrics?.reply_count ?? 0,
      impressions: raw.public_metrics?.impression_count ?? 0,
      lang: raw.lang ?? null,
      created_at: isoToEpochMs(raw.created_at),
      raw: stringifyJSON(raw),
    }),
  },

  followers: {
    key: "x_followers",
    table: "x_followers",
    columns: ["id", "username", "name", "followers", "following", "description", "verified", "created_at", "raw"],
    supportsSince: false,
    pagination: { itemsPath: "data", cursorPath: "meta.next_token" },
    request: ({ cursor, ownId }) => ({
      path: `/2/users/${ownId}/followers`,
      query: { max_results: "1000", "user.fields": USER_FIELDS, ...(cursor ? { pagination_token: cursor } : {}) },
    }),
    normalize: (raw) => ({
      id: String(raw.id),
      username: raw.username ?? null,
      name: raw.name ?? null,
      followers: raw.public_metrics?.followers_count ?? 0,
      following: raw.public_metrics?.following_count ?? 0,
      description: raw.description ?? null,
      verified: raw.verified ? 1 : 0,
      created_at: isoToEpochMs(raw.created_at),
      raw: stringifyJSON(raw),
    }),
  },
}
