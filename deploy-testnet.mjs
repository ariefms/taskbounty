// deploy-testnet.mjs — one-shot TaskBounty testnet deploy.
// 1. Generates a fresh ed25519 keypair.
// 2. Creates a free testnet dev account via the NEAR testnet helper/faucet.
// 3. Saves the private key under contract/.near-credentials/testnet/ (chmod 600, gitignored).
// 4. Deploys target/near/task_bounty.wasm to the new account.
// 5. Runs a read-only get_task_count view call to verify.
// Testnet only. No mainnet, no real funds.
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/hatch/workspace/near-hackathon/worker/package.json');
const nearApi = require('near-api-js');
const { Account, JsonRpcProvider, KeyPair } = nearApi;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_DIR = path.join(HERE, 'contract');
const WASM_PATH = path.join(CONTRACT_DIR, 'target/near/task_bounty.wasm');
const RPC_URL = 'https://rpc.testnet.near.org';
const HELPER_URL = 'https://helper.testnet.near.org/account';

// Reuse an already-created account if EXISTING_ACCOUNT is set (key is read
// from contract/.near-credentials/testnet/<account>.json); otherwise create
// a fresh dev account via the helper.
const existingAccount = process.env.EXISTING_ACCOUNT || '';
let accountId;
let keyPair;
if (existingAccount) {
  accountId = existingAccount;
  const keyFile = path.join(CONTRACT_DIR, '.near-credentials', 'testnet', `${accountId}.json`);
  const saved = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  keyPair = KeyPair.fromString(saved.private_key);
  console.log('reusing account:', accountId);
} else {
  const suffix = randomBytes(4).toString('hex');
  accountId = `taskbounty-${suffix}.testnet`;
  keyPair = KeyPair.fromRandom('ed25519');
  console.log('account:', accountId);
}
const publicKey = keyPair.getPublicKey().toString();
console.log('public key:', publicKey);

if (!fs.existsSync(WASM_PATH)) {
  console.error('WASM not found at', WASM_PATH);
  process.exit(1);
}

if (!existingAccount) {
  // 1. Create the account via the testnet helper (free faucet).
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

  // 2. Save the key (chmod 600). Never printed.
  const credDir = path.join(CONTRACT_DIR, '.near-credentials', 'testnet');
  fs.mkdirSync(credDir, { recursive: true });
  const keyFile = path.join(credDir, `${accountId}.json`);
  fs.writeFileSync(
    keyFile,
    JSON.stringify({ account_id: accountId, public_key: publicKey, private_key: keyPair.toString() }, null, 2),
  );
  fs.chmodSync(keyFile, 0o600);
  console.log('key saved to:', keyFile);
}

// 3. Deploy the contract.
const provider = new JsonRpcProvider({ url: RPC_URL });
const account = new Account(accountId, provider, keyPair.toString());
const wasm = fs.readFileSync(WASM_PATH);
console.log('deploying', WASM_PATH, `(${wasm.length} bytes) ...`);
const outcome = await account.deployContract(wasm);
const txHash = outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id ?? 'unknown';
console.log('DEPLOY_TX_HASH:', txHash);
console.log('deploy status:', JSON.stringify(outcome?.status ?? outcome?.transaction_outcome?.outcome?.status ?? null));

// 4. Verify with a read-only view call.
const count = await provider.callFunction({ contractId: accountId, method: 'get_task_count', args: {} });
console.log('VIEW get_task_count:', count);
console.log('CONTRACT_ACCOUNT:', accountId);
