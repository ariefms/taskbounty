// e2e-smoke.mjs — end-to-end smoke test of TaskBounty on NEAR testnet.
// 1. Creator (contract dev account) posts a research task, 0.1 NEAR bounty.
// 2. The demo worker (agent account) claims it, researches, submits proof.
// 3. Creator approves and pays; verifies task Paid + agent received the bounty.
// 4. Cancels the leftover task #0 from the first run (example.com was too short
//    for the worker's extractive summariser — an honest skip, not a bug).
// Testnet only. No mainnet, no real funds.
// Usage: node e2e-smoke.mjs
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/home/hatch/workspace/near-hackathon/worker/package.json');
const { Account, JsonRpcProvider, KeyPair, teraToGas } = require('near-api-js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RPC_URL = 'https://rpc.testnet.near.org';
const CONTRACT_ID = 'taskbounty-75c73ec3.testnet';
const CREATOR_ID = 'taskbounty-75c73ec3.testnet';
const AGENT_ID = 'taskbounty-agent-96c9722a.testnet';

const loadKey = (file) => KeyPair.fromString(JSON.parse(fs.readFileSync(file, 'utf8')).private_key);
const creatorKey = loadKey(path.join(HERE, 'contract', '.near-credentials', 'testnet', `${CREATOR_ID}.json`));
const agentKey = loadKey(path.join(HERE, 'worker', '.near-credentials', 'testnet', `${AGENT_ID}.json`));

const provider = new JsonRpcProvider({ url: RPC_URL });
const creator = new Account(CREATOR_ID, provider, creatorKey.toString());
const agent = new Account(AGENT_ID, provider, agentKey.toString());

const view = (method, args) => provider.callFunction({ contractId: CONTRACT_ID, method, args });
const balanceOf = async (id) => (await provider.query({ request_type: 'view_account', account_id: id, finality: 'final' })).amount;
const fmt = (yocto) => `${(BigInt(yocto) / 10n ** 24n)}.${String(BigInt(yocto) % 10n ** 24n).padStart(24, '0').slice(0, 4)} NEAR`;
// near-api-js v7: callFunction returns the decoded return value; callFunctionRaw
// returns the raw outcome, whose transaction_outcome.id is the tx hash.
const txHash = (outcome) => outcome?.transaction_outcome?.id ?? 'unknown';

console.log('== TaskBounty e2e smoke test (testnet) ==');
console.log('contract:', CONTRACT_ID);
const agentBefore = await balanceOf(AGENT_ID);
console.log('agent balance before:', fmt(agentBefore));

// 1. Creator posts a research task (0.1 NEAR bounty) about the NEAR hackathon page.
const bounty = 10n ** 23n; // 0.1 NEAR in yocto
const create = await creator.callFunctionRaw({
  contractId: CONTRACT_ID,
  methodName: 'create_task',
  args: {
    title: 'Summarise the NEAR hackathon announcement',
    description: 'Read https://www.near.org/blog/near-hackathon-build-beyond-boundaries and summarise the key facts (prizes, tracks, deadline) in a few sentences.',
    category: 'research',
  },
  gas: teraToGas('30'),
  deposit: bounty,
});
const createTx = txHash(create);
console.log('1. create_task tx:', createTx);

const count = await view('get_task_count', {});
const taskId = Number(count) - 1;
let task = await view('get_task', { task_id: taskId });
console.log(`   task #${taskId}:`, JSON.stringify({ status: task.status, bounty: task.bounty, creator: task.creator }));
if (task.status !== 'Open') throw new Error(`expected Open, got ${task.status}`);

// 2. Worker claims + researches + submits proof (live --once run).
console.log('2. running worker --once ...');
execFileSync('node', ['src/index.js', '--once'], {
  cwd: path.join(HERE, 'worker'),
  stdio: 'inherit',
  timeout: 120_000,
});
task = await view('get_task', { task_id: taskId });
console.log(`   task #${taskId} after worker:`, JSON.stringify({ status: task.status, agent: task.agent, proof_len: (task.proof || '').length }));
if (task.status !== 'ProofSubmitted') throw new Error(`expected ProofSubmitted, got ${task.status}`);
if (!task.proof || task.proof.length < 20) throw new Error('proof looks empty');
console.log('   proof preview:', task.proof.slice(0, 200).replace(/\n/g, ' '));

// 3. Creator approves and pays.
const approve = await creator.callFunctionRaw({
  contractId: CONTRACT_ID,
  methodName: 'approve_and_pay',
  args: { task_id: taskId },
  gas: teraToGas('30'),
  deposit: 0n,
});
const approveTx = txHash(approve);
console.log('3. approve_and_pay tx:', approveTx);

task = await view('get_task', { task_id: taskId });
const agentAfter = await balanceOf(AGENT_ID);
console.log(`   task #${taskId} final:`, JSON.stringify({ status: task.status }));
console.log('   agent balance after:', fmt(agentAfter));
console.log('   agent received:', fmt(BigInt(agentAfter) - BigInt(agentBefore)), '(bounty 0.1 NEAR minus worker gas)');
if (task.status !== 'Paid') throw new Error(`expected Paid, got ${task.status}`);
if (BigInt(agentAfter) <= BigInt(agentBefore)) throw new Error('agent balance did not increase');

// 4. Cancel the leftover task #0 (example.com too short for the summariser).
const cancel = await creator.callFunctionRaw({
  contractId: CONTRACT_ID,
  methodName: 'cancel_task',
  args: { task_id: 0 },
  gas: teraToGas('30'),
  deposit: 0n,
});
console.log('4. cancel_task #0 tx:', txHash(cancel));
task = await view('get_task', { task_id: 0 });
console.log('   task #0 final:', JSON.stringify({ status: task.status }));
if (task.status !== 'Cancelled') throw new Error(`expected Cancelled, got ${task.status}`);

console.log('== E2E SMOKE TEST PASSED ==');
console.log('create tx:', createTx);
console.log('approve tx:', approveTx);
