// X (Twitter) adapter — two pluggable modes:
//   API v2 (default if SOCIAL_X_BEARER set): official, compliant, good for writes.
//     env: SOCIAL_X_BEARER, SOCIAL_X_USER_ID
//   cookie  (free, if SOCIAL_X_AUTH_TOKEN + SOCIAL_X_CT0 set): reverse-engineered
//     GraphQL frontend (twikit / agent-twitter-client pattern). No key, no visible
//     rate limits — makes "runs free with your own cookies" real. Fragile: GraphQL
//     query-ids drift; keep pinned ids in one place. Optional HTTPS_PROXY.
import { isoToEpochMs, stringifyJSON } from "../sqlsync/collection.mjs"
import { proxyFetch } from "./_http.mjs"

const V2_BASE = "https://api.x.com"
// Public web-app bearer used by x.com itself (same constant twikit/agent-twitter-client use).
const WEB_BEARER =
  "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
// Pinned GraphQL query ids (drift over time — update here if X ships new ones).
const GQL = { UserTweets: "V7H0Ap3_Hh2FyS75OCDO3Q" }

const TWEET_FIELDS =
  "created_at,public_metrics,lang,conversation_id,in_reply_to_user_id,referenced_tweets,entities"
const USER_FIELDS = "created_at,public_metrics,description,location,verified,username,name"

function v2Api(bearer, ) {
  return {
    mode: "v2",
    get: async (path, query) => {
      const url = new URL(V2_BASE + path)
      for (const [k, v] of Object.entries(query ?? {})) if (!k.startsWith("__")) url.searchParams.set(k, v)
      const res = await proxyFetch(url, { headers: { Authorization: `Bearer ${bearer}` } })
      return {
        status: res.status,
        headers: { "retry-after": res.headers.get("x-rate-limit-reset-after") ?? res.headers.get("retry-after") },
        json: () => res.json(),
      }
    },
  }
}

// Translate an X GraphQL timeline envelope into the v2 shape { data:[...], meta:{next_token} }
// so the collections below are transport-agnostic.
function graphqlTimelineToV2(payload) {
  const instructions =
    payload?.data?.user?.result?.timeline_v2?.timeline?.instructions ??
    payload?.data?.user?.result?.timeline?.timeline?.instructions ?? []
  const data = []
  let next = null
  for (const ins of instructions) {
    for (const entry of ins.entries ?? []) {
      const t = entry?.content?.itemContent?.tweet_results?.result
      const legacy = t?.legacy
      if (legacy) {
        data.push({
          id: t.rest_id ?? entry.entryId,
          author_id: legacy.user_id_str ?? null,
          text: legacy.full_text ?? legacy.text,
          public_metrics: {
            like_count: legacy.favorite_count,
            retweet_count: legacy.retweet_count,
            reply_count: legacy.reply_count,
            impression_count: Number(t?.views?.count ?? 0),
          },
          lang: legacy.lang,
          created_at: legacy.created_at ? new Date(legacy.created_at).toISOString() : null,
        })
      }
      if (entry?.content?.cursorType === "Bottom") next = entry.content.value
    }
  }
  return { data, meta: next ? { next_token: next } : {} }
}

function cookieApi(authToken, ct0) {
  return {
    mode: "cookie",
    get: async (_path, query) => {
      // We only implement the tweets timeline in cookie mode.
      const variables = {
        userId: query.__ownId,
        count: 100,
        cursor: query.pagination_token ?? undefined,
        includePromotedContent: false,
        withVoice: true,
      }
      const url = new URL(`https://x.com/i/api/graphql/${GQL.UserTweets}/UserTweets`)
      url.searchParams.set("variables", JSON.stringify(variables))
      url.searchParams.set("features", JSON.stringify({ responsive_web_graphql_timeline_navigation_enabled: true }))
      const res = await proxyFetch(url, {
        headers: {
          authorization: `Bearer ${WEB_BEARER}`,
          cookie: `auth_token=${authToken}; ct0=${ct0}`,
          "x-csrf-token": ct0,
          "x-twitter-auth-type": "OAuth2Session",
          "content-type": "application/json",
        },
      })
      const payload = await res.json().catch(() => ({}))
      return { status: res.status, headers: { "retry-after": res.headers.get("x-rate-limit-reset") }, json: async () => graphqlTimelineToV2(payload) }
    },
  }
}

export function xApi() {
  if (process.env.SOCIAL_X_AUTH_TOKEN && process.env.SOCIAL_X_CT0)
    return cookieApi(process.env.SOCIAL_X_AUTH_TOKEN, process.env.SOCIAL_X_CT0)
  if (process.env.SOCIAL_X_BEARER) return v2Api(process.env.SOCIAL_X_BEARER)
  throw new Error("Set SOCIAL_X_BEARER (API v2) or SOCIAL_X_AUTH_TOKEN+SOCIAL_X_CT0 (free cookie mode)")
}

export const collections = {
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
        __ownId: ownId, // consumed by cookie mode; ignored by v2 URL builder as a query param
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
