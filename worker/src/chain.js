// NEAR chain access via near-api-js v7 (verified: npm view near-api-js version -> 7.4.0).
//   provider.callFunction({ contractId, method, args })        — view calls
//   new Account(accountId, provider, privateKey)
//   account.callFunction({ contractId, methodName, args, gas, deposit }) — change calls
// Method names come from DESIGN.md only: list_tasks, claim_task, submit_proof.

import { Account, JsonRpcProvider, teraToGas } from "near-api-js";

export function createProvider(rpcUrl) {
  return new JsonRpcProvider({ url: rpcUrl });
}

export function createAccount(accountId, provider, privateKey) {
  return new Account(accountId, provider, privateKey);
}

/** View: list_tasks(from_index, limit) — newest first per DESIGN.md. */
export async function listTasks(provider, contractId, fromIndex = 0, limit = 50) {
  const tasks = await provider.callFunction({
    contractId,
    method: "list_tasks",
    args: { from_index: fromIndex, limit },
  });
  return Array.isArray(tasks) ? tasks : [];
}

/** Change: claim_task(task_id), deposit 1 yocto (per DESIGN.md). */
export async function claimTask(account, contractId, taskId) {
  return account.callFunction({
    contractId,
    methodName: "claim_task",
    args: { task_id: taskId },
    gas: teraToGas("30"),
    deposit: 1n,
  });
}

/** Change: submit_proof(task_id, proof), no deposit. */
export async function submitProof(account, contractId, taskId, proof) {
  return account.callFunction({
    contractId,
    methodName: "submit_proof",
    args: { task_id: taskId, proof },
    gas: teraToGas("30"),
    deposit: 0n,
  });
}
