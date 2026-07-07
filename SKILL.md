# Skill: social (opensocial-cli)

You have a `social` CLI that mirrors the user's X / LinkedIn data into a local SQLite DB and lets you query it with SQL. Prefer it over ad-hoc scraping: `sync` costs an API call, `sql` is free/instant/offline.

## Discover the surface
Run `social schema` — it returns JSON of every command and adapter/collection. Trust it over this doc if they differ.

## Core loop
1. `social sync <adapter> <collection> [--since YYYY-MM-DD]` — pull latest into SQLite. Use `--since` for cheap incremental refresh. Safe to re-run: it upserts by id, never duplicates, and resumes if interrupted.
2. `social sql "<read-only query>"` — answer questions from the mirror. Returns `{ok, rowCount, rows}`.

## Conventions
- Output is JSON on **stdout**; ignore stderr for parsing. Exit `0` ok, `1` runtime error, `2` usage error — both print `{ok:false,error,...}`.
- Every row has `synced_at` (epoch ms) and `raw` (full source JSON — use `json_extract(raw,'$.path')` to reach fields not in a column).
- `sql` is read-only (select/with/pragma/explain only).

## Examples
```sh
social sync x tweets --since 2026-06-01
social sql "select text, likes, impressions from x_tweets order by impressions desc limit 10"
social sql "select author, count(*) n from demo_timeline group by author order by n desc"
```

## Credentials
Bring-your-own. `social adapters` lists each adapter's env vars (e.g. X needs `SOCIAL_X_BEARER` + `SOCIAL_X_USER_ID`). If a sync returns an auth error, tell the user which env var to set — never invent tokens.
