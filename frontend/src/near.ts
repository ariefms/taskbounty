import { JsonRpcProvider, formatNearAmount, parseNearAmount } from 'near-api-js';
import { internalActionToNaj, setupWalletSelector } from '@near-wallet-selector/core';
import type { FunctionCallAction, WalletSelector } from '@near-wallet-selector/core';
import { setupModal } from '@near-wallet-selector/modal-ui';
import type { WalletSelectorModal } from '@near-wallet-selector/modal-ui';
import { setupMyNearWallet } from '@near-wallet-selector/my-near-wallet';
import type { Task } from './types';

// ---------------------------------------------------------------------------
// Config — testnet only. Never point this at mainnet.
// Contract account comes from VITE_CONTRACT_ID; the default is a placeholder
// (the contract is not deployed yet). Set .env to the real testnet account
// once it exists. No real address is hardcoded anywhere.
// ---------------------------------------------------------------------------
export const CONTRACT_ID: string =
  import.meta.env.VITE_CONTRACT_ID || 'taskbounty.testnet';
export const RPC_URL = 'https://rpc.testnet.near.org';
export const EXPLORER_URL = 'https://testnet.nearblocks.io';
export const NETWORK_ID = 'testnet' as const;

// All change methods from DESIGN.md — the wallet modal requests a
// function-call access key limited to exactly these.
export const CHANGE_METHODS = [
  'create_task',
  'claim_task',
  'submit_proof',
  'approve_and_pay',
  'reject_proof',
  'cancel_task',
] as const;

const GAS = '30000000000000'; // 30 TGas — plenty for these simple calls.

// ---------------------------------------------------------------------------
// Read-only RPC (no wallet needed). The task list works for visitors.
// ---------------------------------------------------------------------------
const provider = new JsonRpcProvider({ url: RPC_URL });

async function viewCall<T>(method: string, args: Record<string, unknown>): Promise<T> {
  const result = await provider.callFunction({
    contractId: CONTRACT_ID,
    method,
    args,
    blockQuery: { finality: 'final' },
  });
  // near-api-js returns the JSON-decoded result; tolerate a raw string too.
  if (typeof result === 'string') return JSON.parse(result) as T;
  return result as T;
}

export async function getTaskCount(): Promise<number> {
  const n = await viewCall<number | string>('get_task_count', {});
  return typeof n === 'string' ? Number(n) : n;
}

export async function listTasks(fromIndex = 0, limit = 50): Promise<Task[]> {
  return viewCall<Task[]>('list_tasks', { from_index: fromIndex, limit });
}

export async function getTask(taskId: number): Promise<Task | null> {
  return viewCall<Task | null>('get_task', { task_id: taskId });
}

// ---------------------------------------------------------------------------
// Amount helpers — yoctoNEAR (string) <-> NEAR (display string)
// ---------------------------------------------------------------------------
export function yoctoToNear(yocto: string): string {
  // formatNearAmount keeps up to 5 decimals by default; trim trailing zeros.
  const s = formatNearAmount(yocto, 5);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

export function nearToYocto(near: string): string {
  if (!/^\d+(\.\d+)?$/.test(near.trim())) {
    throw new Error(`Invalid NEAR amount: "${near}"`);
  }
  const yocto = parseNearAmount(near.trim() as `${number}`);
  if (yocto === null) throw new Error(`Invalid NEAR amount: "${near}"`);
  return yocto;
}

// ---------------------------------------------------------------------------
// Wallet (MyNearWallet via wallet-selector). Lazy init so the page loads
// and shows tasks even when no wallet is connected.
// ---------------------------------------------------------------------------
let selectorPromise: Promise<WalletSelector> | null = null;
let modal: WalletSelectorModal | null = null;

export function getSelector(): Promise<WalletSelector> {
  if (!selectorPromise) {
    selectorPromise = setupWalletSelector({
      network: NETWORK_ID,
      modules: [setupMyNearWallet()],
    });
  }
  return selectorPromise;
}

export async function showWalletModal(): Promise<void> {
  const selector = await getSelector();
  if (!modal) {
    modal = setupModal(selector, {
      contractId: CONTRACT_ID,
      methodNames: [...CHANGE_METHODS],
    });
  }
  modal.show();
}

export async function getSignedInAccount(): Promise<string | null> {
  const selector = await getSelector();
  if (!selector.isSignedIn()) return null;
  const wallet = await selector.wallet();
  const accounts = await wallet.getAccounts();
  return accounts[0]?.accountId ?? null;
}

export async function signOut(): Promise<void> {
  const selector = await getSelector();
  const wallet = await selector.wallet();
  await wallet.signOut();
}

export interface TxResult {
  hash: string | null; // null when the wallet flow returns no outcome (redirect wallets)
}

/** Sign + send one contract call. Throws on wallet/receipt failure. */
export async function callContract(
  accountId: string,
  methodName: string,
  args: Record<string, unknown>,
  depositYocto: string,
): Promise<TxResult> {
  const selector = await getSelector();
  const wallet = await selector.wallet();
  // Build the action in wallet-selector's own (string gas/deposit) shape and
  // convert with its public helper — near-api-js's action objects come from a
  // different copy of @near-js/transactions and are not type-compatible here.
  const action: FunctionCallAction = {
    type: 'FunctionCall',
    params: { methodName, args, gas: GAS, deposit: depositYocto },
  };
  const outcome = await wallet.signAndSendTransaction({
    signerId: accountId,
    receiverId: CONTRACT_ID,
    actions: [internalActionToNaj(action)],
  });
  // Browser wallets may return void (redirect flow); MyNearWallet normally
  // returns the outcome. Either way the tx hash link is shown when available.
  const hash =
    outcome && typeof outcome === 'object' && 'transaction' in outcome
      ? ((outcome as { transaction?: { hash?: string } }).transaction?.hash ?? null)
      : null;
  return { hash };
}

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_URL}/txns/${hash}`;
}

export function explorerAccountUrl(accountId: string): string {
  return `${EXPLORER_URL}/address/${accountId}`;
}
