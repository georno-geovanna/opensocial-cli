// Shared fetch with optional per-run proxy. Proxy stance: we don't ship a fleet.
// Default = the user's own IP (low volume, honest). Power users set HTTPS_PROXY to
// bring a residential IP for scale. Zero hard dep: uses undici's ProxyAgent only if
// present; otherwise falls back to plain fetch with a one-time stderr note.
let dispatcher
let warned = false

async function getDispatcher() {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy
  if (!proxy) return undefined
  if (dispatcher !== undefined) return dispatcher || undefined
  try {
    const { ProxyAgent } = await import("undici")
    dispatcher = new ProxyAgent(proxy)
  } catch {
    dispatcher = null
    if (!warned) {
      warned = true
      process.stderr.write(
        JSON.stringify({ warn: "HTTPS_PROXY set but undici not available; run `npm i undici` or Node >=24 with --use-env-proxy" }) + "\n"
      )
    }
  }
  return dispatcher || undefined
}

export async function proxyFetch(url, opts = {}) {
  const d = await getDispatcher()
  return fetch(url, d ? { ...opts, dispatcher: d } : opts)
}
