// Config from env vars (+ optional .env file in this directory).
// TESTNET ONLY: any other NEAR_NETWORK value is refused.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadDotEnv(path = join(HERE, "..", ".env")) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

export function loadConfig(env = process.env) {
  const network = env.NEAR_NETWORK || "testnet";
  if (network !== "testnet") {
    throw new Error(
      `Refusing to run: NEAR_NETWORK=${network}. This worker is testnet-only.`,
    );
  }
  return {
    network,
    rpcUrl: env.RPC_URL || "https://rpc.testnet.near.org",
    contractId: env.CONTRACT_ID || "",
    accountId: env.WORKER_ACCOUNT_ID || "",
    // Private key as an "ed25519:..." string, or a path to a key file.
    // Never commit the key itself; see .env.example.
    privateKey: env.WORKER_PRIVATE_KEY || "",
    privateKeyFile: env.WORKER_KEY_FILE || "",
    pollIntervalMs: Number(env.POLL_INTERVAL_MS || 60_000),
    fetchTimeoutMs: Number(env.FETCH_TIMEOUT_MS || 10_000),
  };
}

/** Resolve the worker private key (direct value wins, else key file). */
export function resolvePrivateKey(config) {
  if (config.privateKey) return config.privateKey.trim();
  if (config.privateKeyFile) {
    const raw = readFileSync(config.privateKeyFile, "utf8").trim();
    // Accept either a bare key string or a {"private_key": "..."} JSON file.
    try {
      const parsed = JSON.parse(raw);
      if (parsed.private_key) return String(parsed.private_key).trim();
    } catch {
      /* not JSON — treat the whole file as the key */
    }
    return raw;
  }
  return "";
}
