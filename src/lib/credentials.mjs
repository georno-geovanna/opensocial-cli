// Secure credential storage for bring-your-own provider keys — mirrors the pattern
// from @usesocial/cli's lib/bearer: OS keychain via @napi-rs/keyring when available,
// falling back to a 0600 file at ~/.social/credentials.json. Keeps secrets out of
// shell history / env dumps. Keyring is an OPTIONAL dep (dynamic import) so the tool
// stays zero-required-deps; without it, the 0600 file is used.
import { homedir } from "node:os"
import { join } from "node:path"
import { mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync, existsSync } from "node:fs"

const HOME = join(homedir(), ".social")
const FILE = join(HOME, "credentials.json")
const SERVICE = "opensocial-cli"
const ACCOUNT = "default"

async function keyringEntry() {
  try {
    const { AsyncEntry } = await import("@napi-rs/keyring")
    return AsyncEntry ? new AsyncEntry(SERVICE, ACCOUNT) : null
  } catch {
    return null
  }
}

function readFileCreds() {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : {}
  } catch {
    return {}
  }
}

function writeFileCreds(obj) {
  mkdirSync(HOME, { recursive: true })
  writeFileSync(FILE, JSON.stringify(obj, null, 0) + "\n", { mode: 0o600 })
  chmodSync(FILE, 0o600)
}

/** Load stored credentials (keychain first, else 0600 file). Returns a flat env map. */
export async function loadCredentials() {
  const entry = await keyringEntry()
  if (entry) {
    try {
      const secret = await entry.getPassword()
      if (secret) return JSON.parse(secret)
    } catch {
      /* fall through to file */
    }
  }
  return readFileCreds()
}

/** Merge + persist credentials (keychain if available, else 0600 file). */
export async function saveCredentials(patch) {
  const current = await loadCredentials()
  const next = { ...current, ...patch }
  const entry = await keyringEntry()
  if (entry) {
    await entry.setPassword(JSON.stringify(next))
    return { store: "keychain", keys: Object.keys(next) }
  }
  writeFileCreds(next)
  return { store: "file(0600)", path: FILE, keys: Object.keys(next) }
}

export async function clearCredentials() {
  const entry = await keyringEntry()
  if (entry) {
    try {
      await entry.deletePassword()
    } catch {
      /* ignore */
    }
  }
  if (existsSync(FILE)) rmSync(FILE)
}

/** Apply stored creds into process.env WITHOUT overriding explicitly-set env vars. */
export async function applyStoredCredentialsToEnv() {
  const creds = await loadCredentials()
  for (const [k, v] of Object.entries(creds)) {
    if (process.env[k] === undefined && typeof v === "string") process.env[k] = v
  }
  return Object.keys(creds)
}
