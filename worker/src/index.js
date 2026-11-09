// TaskBounty demo worker — entry point.
//
//   node src/index.js --dry-run   list Open research tasks, research one,
//                                 print exactly what WOULD be submitted.
//                                 No account/key needed, no signing.
//   node src/index.js --once      one poll: claim + research + submit (live).
//   node src/index.js --loop      poll every POLL_INTERVAL_MS, one task/poll.
//
// Honest scope: category "research" only, extractive summary only, no LLM.
// If research fails (fetch error, no usable text) the task is skipped and
// the reason is logged — a summary is never fabricated.

import { loadConfig, loadDotEnv, resolvePrivateKey } from "./config.js";
import { createProvider, createAccount, listTasks, claimTask, submitProof } from "./chain.js";
import { doResearch } from "./research.js";
import { isResearchTask } from "./extract.js";

const log = (...a) => console.log(new Date().toISOString(), ...a);

function usage() {
  console.log(`Usage: node src/index.js [--dry-run | --once | --loop]
  --dry-run  read-only: list tasks, research one, print the would-be proof
  --once     one live poll (claim + research + submit_proof)
  --loop     poll every POLL_INTERVAL_MS (default 60000), one task per poll
Env: CONTRACT_ID, WORKER_ACCOUNT_ID, WORKER_PRIVATE_KEY or WORKER_KEY_FILE,
     NEAR_NETWORK=testnet, RPC_URL, POLL_INTERVAL_MS (see .env.example)`);
}

async function pickTask(provider, contractId) {
  const tasks = await listTasks(provider, contractId, 0, 50);
  const open = tasks.filter((t) => t.status === "Open");
  const inScope = open.filter(isResearchTask);
  return { tasks, open, inScope };
}

async function runOnce({ config, dryRun }) {
  if (!config.contractId) {
    throw new Error("CONTRACT_ID is not set — nothing to poll. See .env.example.");
  }
  const provider = createProvider(config.rpcUrl);
  const { tasks, open, inScope } = await pickTask(provider, config.contractId);
  log(`list_tasks: ${tasks.length} total, ${open.length} Open, ${inScope.length} in scope (research)`);
  if (inScope.length === 0) {
    log("No Open research task to work on. Nothing to do.");
    return { done: false, reason: "no in-scope task" };
  }
  const task = inScope[0];
  log(`Picked task #${task.id}: ${task.title} (bounty ${task.bounty} yocto)`);

  const result = await doResearch(task, { fetchTimeoutMs: config.fetchTimeoutMs });
  if (!result.ok) {
    log(`SKIP task #${task.id}: ${result.reason}`);
    return { done: false, reason: result.reason };
  }
  log(`Researched ${result.sourceUrl} (${result.textChars} chars -> ${result.sentences.length} sentences)`);

  if (dryRun) {
    console.log("\n--- DRY RUN: proof that WOULD be submitted (no transaction signed) ---");
    console.log(result.summary);
    console.log("--- end of would-be proof ---\n");
    log(`DRY RUN: would claim task #${task.id} then submit_proof with the text above.`);
    return { done: false, dryRun: true, taskId: task.id, proof: result.summary };
  }

  // Live path: needs account + key.
  const key = resolvePrivateKey(config);
  if (!config.accountId || !key) {
    throw new Error("Live mode needs WORKER_ACCOUNT_ID and WORKER_PRIVATE_KEY (or WORKER_KEY_FILE).");
  }
  if (String(task.creator) === config.accountId) {
    log(`SKIP task #${task.id}: worker is the creator and cannot claim its own task.`);
    return { done: false, reason: "own task" };
  }
  const account = createAccount(config.accountId, provider, key);
  log(`Claiming task #${task.id}...`);
  await claimTask(account, config.contractId, task.id);
  log(`Claimed task #${task.id}. Submitting proof...`);
  await submitProof(account, config.contractId, task.id, result.summary);
  log(`Proof submitted for task #${task.id}. Awaiting creator approval.`);
  return { done: true, taskId: task.id };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const once = args.includes("--once");
  const loop = args.includes("--loop") || (!dryRun && !once);
  if (args.includes("--help") || args.includes("-h") || (!dryRun && !once && !loop)) {
    usage();
    process.exit(args.includes("--help") || args.includes("-h") ? 0 : 2);
  }

  loadDotEnv();
  const config = loadConfig();
  log(`TaskBounty worker starting (network=${config.network}, contract=${config.contractId || "(unset)"}, mode=${dryRun ? "dry-run" : loop ? "loop" : "once"})`);

  if (dryRun) {
    await runOnce({ config, dryRun: true });
    return;
  }
  if (once) {
    await runOnce({ config, dryRun: false });
    return;
  }

  // Loop mode: one task per poll, errors logged, never crash the loop.
  for (;;) {
    try {
      await runOnce({ config, dryRun: false });
    } catch (err) {
      log(`Poll error: ${err.message}`);
    }
    log(`Sleeping ${config.pollIntervalMs} ms...`);
    await new Promise((r) => setTimeout(r, config.pollIntervalMs));
  }
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
