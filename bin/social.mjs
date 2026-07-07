#!/usr/bin/env node
import { main } from "../src/cli.mjs"
main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(JSON.stringify({ ok: false, error: "Fatal", message: String(e?.message ?? e) }) + "\n")
  process.exit(1)
})
