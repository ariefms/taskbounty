// create-agent-account.mjs — create a free NEAR testnet account for the
// TaskBounty worker (agent role) via the testnet helper/faucet.
// Testnet only. No mainnet, no real funds.
// Usage: node create-agent-account.mjs
// Output: prints the new account ID; key saved to
//   worker/.near-credentials/testnet/<account>.json (chmod 600, gitignored).
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/hatch/workspace/near-hackathon/worker/package.json');
const { KeyPair } = require('near-api-js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HELPER_URL = 'https://helper.testnet.near.org/account';

const suffix = randomBytes(4).toString('hex');
const accountId = `taskbounty-agent-${suffix}.testnet`;
const keyPair = KeyPair.fromRandom('ed25519');
const publicKey = keyPair.getPublicKey().toString();

const res = await fetch(HELPER_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ newAccountId: accountId, newAccountPublicKey: publicKey }),
});
const bodyText = await res.text();
console.log('helper status:', res.status);
console.log('helper body:', bodyText.slice(0, 500));
if (!res.ok) {
  console.error('HELPER FAILED — cannot create testnet account');
  process.exit(2);
}

const credDir = path.join(HERE, 'worker', '.near-credentials', 'testnet');
fs.mkdirSync(credDir, { recursive: true });
const keyFile = path.join(credDir, `${accountId}.json`);
fs.writeFileSync(
  keyFile,
  JSON.stringify({ account_id: accountId, public_key: publicKey, private_key: keyPair.toString() }, null, 2),
);
fs.chmodSync(keyFile, 0o600);
console.log('AGENT_ACCOUNT:', accountId);
console.log('key saved to:', keyFile);
