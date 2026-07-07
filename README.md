# opensocial-cli

**Open-source LinkedIn & X CLI — mirror your social data into local SQLite and query it from any shell.**

A clean-room reconstruction of the [`@usesocial/cli`](https://usesocial.dev) *architecture* — its best idea (a local-first SQLite mirror of your social graph, built for agents) with **bring-your-own-keys** and **no hosted backend / no metered markup**.

> You call X / LinkedIn with your *own* API credentials. Your data lands in a local SQLite DB you fully own. `sql` queries are free, instant, and offline.

## Why

The clever part of usesocial isn't the outreach features — it's **`sqlsync`**: `sync` pulls a collection from a provider into local SQLite (incrementally, resumably), and then `sql` lets you (or your agent) run arbitrary read-only SQL over your mirrored graph for free. The upstream product wraps that in a hosted backend that holds provider creds (LinkedIn via Unipile), proxies, and **metered billing with markup**. This project keeps the good idea and drops the toll booth.

## Install

```sh
git clone <this repo> && cd opensocial && npm link   # needs Node >= 22.5 (built-in node:sqlite)
```

## Quickstart (zero credentials — demo adapter)

```sh
social sync demo timeline
social sql "select author, text, likes from demo_timeline order by likes desc limit 5"
```

## Providers & modes (bring-your-own credentials)

Run `social adapters` for the live list. Each provider ships **two modes** so you're never locked to one paid reseller (LinkedIn's Proxycurl got sued and shut down in 2025 — never hard-depend on one).

### X
- **`v2`** (official) — `SOCIAL_X_BEARER` + `SOCIAL_X_USER_ID`. Compliant; good for writes.
- **`cookie`** (free) — `SOCIAL_X_AUTH_TOKEN` + `SOCIAL_X_CT0` from your logged-in browser. Uses X's reverse-engineered GraphQL frontend (the `twikit` / `agent-twitter-client` pattern). No key, no visible rate limits. Fragile: GraphQL query-ids drift (pinned in `src/adapters/x.mjs`). Tweets timeline implemented.

```sh
export SOCIAL_X_BEARER=... SOCIAL_X_USER_ID=...        # or: SOCIAL_X_AUTH_TOKEN=... SOCIAL_X_CT0=...
social sync x tweets --since 2026-06-01
social sql "select text, likes, impressions from x_tweets order by impressions desc limit 10"
```

### LinkedIn
- **`unipile`** (default, reliable) — `SOCIAL_LI_MODE=unipile` + `SOCIAL_UNIPILE_URL` + `SOCIAL_UNIPILE_KEY` + `SOCIAL_LI_ACCOUNT`. Unipile holds your LinkedIn session (hosted auth, 2FA/checkpoints handled). ~€49/mo per-account, not per-request.
- **`voyager`** (free/DIY) — `SOCIAL_LI_MODE=voyager` + `SOCIAL_LI_AT` (your `li_at` cookie) + `SOCIAL_LI_CSRF`. Hits LinkedIn's internal Voyager API directly (`tomquirk/linkedin-api` pattern). **Honest caveat: fragile, ban-prone, realistically <50 profiles/day on a single residential IP.** Use for small, personal pulls only.

```sh
export SOCIAL_LI_MODE=unipile SOCIAL_UNIPILE_URL=... SOCIAL_UNIPILE_KEY=... SOCIAL_LI_ACCOUNT=...
social sync linkedin connections
social sql "select name, headline from li_connections limit 20"
```

### Proxy (scale, honestly)
We ship **no proxy fleet**. Default traffic goes out on **your own IP** (low volume, honest). To scale, set `HTTPS_PROXY` to a residential proxy you provide (`npm i undici` enables it, or Node ≥24 `--use-env-proxy`). That's the no-toll-booth tradeoff: their hosted product's real moat was residential proxies + rate-limit orchestration + billing markup — you bring your own IP instead of renting theirs.

## Commands

| Command | What |
|---|---|
| `social sync <adapter> <collection> [--since ISO] [--max-pages N]` | Pull a collection into local SQLite. Incremental with `--since`; resumable if interrupted. |
| `social sql "<query>"` | Read-only SQL over the local mirror. JSON rows on stdout. |
| `social schema` | Machine-readable command + adapter tree (JSON) — hand this to your agent. |
| `social adapters` | List adapters and their collections. |
| `social login <adapter>` | How to provide credentials (env vars). |

## Agent-first

Every command prints **compact JSON on stdout**; diagnostics go to stderr; exit codes are deterministic (`0` ok, `1` runtime, `2` usage). `social schema` emits the full command tree so an agent can discover the surface. See `SKILL.md`.

## Architecture (the reconstruction)

```
src/sqlsync/           the engine (provider-agnostic)
  sqlite.mjs           wrapper over Node's built-in node:sqlite (colon binds, bool->0/1)
  cursor.mjs           resumable partial-sync cursor  (partial-sync-v1:{json})
  collection.mjs       Collection contract + synced_at/raw conventions + DDL/upsert
  sync.mjs             the loop: plan -> paginated walk -> write-through txn ->
                       per-page cursor checkpoint -> rate-limit retry -> pacing
src/adapters/
  demo.mjs             mock data (no creds) — proves the engine end to end
  x.mjs                X: API v2 (bearer) + free cookie/GraphQL mode — tweets, followers
  linkedin.mjs         LinkedIn: Unipile mode + free Voyager mode — connections, messages, posts
  _http.mjs            shared fetch with optional HTTPS_PROXY (bring-your-own residential IP)
src/cli.mjs            command surface (sync/sql/schema/adapters/login)
bin/social.mjs         entry
```

**Conventions mirrored from the original:** every content table has `id TEXT PRIMARY KEY`, flattened typed columns, `raw` (full source JSON — reach fields not flattened, survive schema drift), and `synced_at` (epoch-ms mirror timestamp). Booleans as `0/1`, timestamps as epoch-ms. A `sync_state` table holds each collection's cursor + high-water mark for incremental/resumable sync.

**The moat, working:** interrupt a sync (`--max-pages 1`) and run it again — it resumes from the exact page it stopped at via the stored `partial-sync-v1` cursor. Re-syncing upserts by `id` (idempotent), never duplicates.

## Adding a provider

Export a `collections` map and an `api` shim (`get(path, query) -> {status, headers, json()}`). Each collection declares its `pagination` (dot-paths to items + next cursor), a `request({cursor, since, ownId})` builder, and a `normalize(raw) -> row`. That's it — the engine handles paging, checkpoints, write-through, and SQL.

## License

MIT. Not affiliated with usesocial. Uses your own provider API credentials under their respective terms.
