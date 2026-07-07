// LinkedIn adapter — two pluggable modes (never hard-depend on one reseller;
// Proxycurl got sued + shut down in 2025):
//   SOCIAL_LI_MODE=unipile  (default, reliable) — BYO Unipile key. Unipile holds the
//     LinkedIn session (hosted auth, 2FA/checkpoints handled). €49/mo per-account.
//     env: SOCIAL_UNIPILE_URL, SOCIAL_UNIPILE_KEY, SOCIAL_LI_ACCOUNT
//   SOCIAL_LI_MODE=voyager  (free/hacker) — BYO li_at cookie + CSRF, hit LinkedIn's
//     internal Voyager API directly. Fragile, ban-prone, ~<50 profiles/day on one
//     residential IP. env: SOCIAL_LI_AT, SOCIAL_LI_CSRF
// Optional HTTPS_PROXY per the no-toll-booth proxy stance (bring your own residential IP).
import { isoToEpochMs, stringifyJSON } from "../sqlsync/collection.mjs"
import { proxyFetch } from "./_http.mjs"

const need = (name) => {
  const v = process.env[name]
  if (!v) throw new Error(`LinkedIn: set ${name}`)
  return v
}

export function linkedinApi() {
  const mode = process.env.SOCIAL_LI_MODE ?? "unipile"
  if (mode === "unipile") {
    const base = need("SOCIAL_UNIPILE_URL").replace(/\/$/, "")
    const key = need("SOCIAL_UNIPILE_KEY")
    return {
      mode,
      get: async (path, query) => {
        const url = new URL(base + path)
        for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v)
        const res = await proxyFetch(url, { headers: { "X-API-KEY": key, accept: "application/json" } })
        return { status: res.status, headers: { "retry-after": res.headers.get("retry-after") }, json: () => res.json() }
      },
    }
  }
  if (mode === "voyager") {
    const li = need("SOCIAL_LI_AT")
    const csrf = need("SOCIAL_LI_CSRF")
    return {
      mode,
      get: async (path, query) => {
        const url = new URL("https://www.linkedin.com" + path)
        for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v)
        const res = await proxyFetch(url, {
          headers: {
            cookie: `li_at=${li}; JSESSIONID="${csrf}"`,
            "csrf-token": csrf,
            "x-restli-protocol-version": "2.0.0",
            accept: "application/vnd.linkedin.normalized+json+2.1",
          },
        })
        return { status: res.status, headers: { "retry-after": res.headers.get("retry-after") }, json: () => res.json() }
      },
    }
  }
  throw new Error(`LinkedIn: unknown SOCIAL_LI_MODE '${mode}' (use unipile|voyager)`)
}

// Collections are written against the Unipile response shape (the reliable default).
// Voyager returns a different envelope; its request()/normalize() live behind the same
// contract so the engine is unchanged — see docs for the Voyager field map.
const acct = () => process.env.SOCIAL_LI_ACCOUNT ?? "me"

export const collections = {
  connections: {
    key: "li_connections",
    table: "li_connections",
    columns: ["id", "name", "headline", "profile_url", "connected_at", "raw"],
    supportsSince: false,
    pagination: { itemsPath: "items", cursorPath: "cursor" },
    request: ({ cursor }) => ({
      path: `/api/v1/users/${acct()}/connections`,
      query: { limit: "100", ...(cursor ? { cursor } : {}) },
    }),
    normalize: (raw) => ({
      id: String(raw.id ?? raw.member_id ?? raw.public_identifier),
      name: raw.name ?? ([raw.first_name, raw.last_name].filter(Boolean).join(" ") || null),
      headline: raw.headline ?? null,
      profile_url: raw.profile_url ?? raw.public_profile_url ?? null,
      connected_at: isoToEpochMs(raw.connected_at ?? raw.created_at),
      raw: stringifyJSON(raw),
    }),
  },

  messages: {
    key: "li_messages",
    table: "li_messages",
    columns: ["id", "chat_id", "sender_id", "text", "is_seen", "sent_at", "raw"],
    supportsSince: true,
    pagination: { itemsPath: "items", cursorPath: "cursor" },
    request: ({ cursor, since }) => ({
      path: `/api/v1/users/${acct()}/messages`,
      query: { limit: "100", ...(since ? { after: String(since) } : {}), ...(cursor ? { cursor } : {}) },
    }),
    normalize: (raw) => ({
      id: String(raw.id),
      chat_id: raw.chat_id ?? raw.conversation_id ?? null,
      sender_id: raw.sender_id ?? null,
      text: raw.text ?? raw.body ?? null,
      is_seen: raw.is_seen ? 1 : 0,
      sent_at: isoToEpochMs(raw.timestamp ?? raw.created_at),
      raw: stringifyJSON(raw),
    }),
  },

  posts: {
    key: "li_posts",
    table: "li_posts",
    columns: ["id", "author_id", "text", "likes", "comments", "reposts", "posted_at", "raw"],
    supportsSince: true,
    pagination: { itemsPath: "items", cursorPath: "cursor" },
    request: ({ cursor }) => ({
      path: `/api/v1/users/${acct()}/posts`,
      query: { limit: "100", ...(cursor ? { cursor } : {}) },
    }),
    normalize: (raw) => ({
      id: String(raw.id ?? raw.share_id ?? raw.social_id),
      author_id: raw.author_id ?? raw.author?.id ?? null,
      text: raw.text ?? raw.commentary ?? null,
      likes: raw.reaction_count ?? raw.likes ?? 0,
      comments: raw.comment_count ?? raw.comments ?? 0,
      reposts: raw.repost_count ?? raw.reposts ?? 0,
      posted_at: isoToEpochMs(raw.date ?? raw.created_at),
      raw: stringifyJSON(raw),
    }),
  },
}
