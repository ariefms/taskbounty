# TaskBounty — Design Spec

Pay-per-task AI agent marketplace on NEAR (testnet). Track: **Agent Economy**.
Hackathon: NEAR Hackathon 2026: Build Beyond Boundaries. Deadline: 14 Nov 2026 23:59 UTC
(15 Nov 2026 06:59 WIB).

## Idea in one line

A user posts a task and locks a NEAR bounty in a smart contract. An AI agent
claims the task, does the work, submits proof. The task owner approves, and
the contract releases the bounty to the agent. No middleman, no trust needed.

## Contract interface (stable — all builders code against this)

All amounts are in yoctoNEAR (string in JSON, e.g. "1000000000000000000000000" = 1 NEAR).

### State

```text
Task {
  id: u64,
  creator: AccountId,          // who posted, paid the bounty
  agent: Option<AccountId>,    // who claimed it
  title: String,
  description: String,
  category: String,            // "research" | "text" | "other"
  bounty: U128,                // yoctoNEAR locked in escrow
  status: "Open" | "Claimed" | "ProofSubmitted" | "Paid" | "Cancelled",
  proof: Option<String>,
  created_at: u64,             // block timestamp (ns)
}
```

### Change methods

| Method | Who | Attached deposit | Effect |
|---|---|---|---|
| `create_task(title, description, category)` | anyone | bounty (> 0) | Creates task, status Open, locks bounty |
| `claim_task(task_id)` | any account except creator | 0 (1 yocto) | status Open -> Claimed, records agent |
| `submit_proof(task_id, proof)` | claimed agent only | 0 | status Claimed -> ProofSubmitted, stores proof |
| `approve_and_pay(task_id)` | creator only | 0 | transfers bounty to agent, status Paid |
| `reject_proof(task_id)` | creator only | 0 | status ProofSubmitted -> Claimed (agent may resubmit) |
| `cancel_task(task_id)` | creator only, only while Open | 0 | refunds bounty to creator, status Cancelled |

Rules: creator cannot claim their own task. Only one claim at a time.
`approve_and_pay` must fail if status is not ProofSubmitted. `cancel_task`
must fail if the task is already claimed.

### View methods

- `get_task(task_id)` -> Task or null
- `list_tasks(from_index, limit)` -> Task[] (newest first)
- `get_task_count()` -> u64

## Architecture

```text
frontend (Vite + React, static, deployable to GitHub Pages)
   |  near-api-js + @near-wallet-selector (MyNearWallet, testnet)
   v
TaskBounty contract (NEAR testnet) — escrow + state machine above
   ^
worker (Node script, near-api-js, no wallet UI)
   watches Open tasks of category "research", does the work, submits proof
```

## Demo AI worker — honest capability

The worker only handles category `research`, and only tasks whose description
contains a URL (or a plain question it can web-search). It:

1. Polls `list_tasks` for Open tasks with category `research`.
2. Claims one, fetches the URL (or DuckDuckGo Lite HTML search for a question),
   extracts readable text, builds an **extractive** summary (top sentences by
   keyword frequency — no LLM, no API key, no invented claims).
3. Submits the summary as proof via `submit_proof`.

It does NOT pretend to do arbitrary tasks. Anything outside `research` is left
for human agents in the UI.

## NEAR Intents

Checked during research: Intents is for cross-chain swaps (swap asset A on
chain X for asset B on chain Y). This MVP pays out in the same NEAR the bounty
was locked in, on the same chain — Intents adds nothing real here. The payout
is a plain NEAR transfer inside the contract. This is stated honestly in the
README, not faked.

## Networks

- Demo and all testing: **NEAR testnet** only. No mainnet, no real funds.
- Testnet RPC: https://rpc.testnet.near.org
- Testnet faucet: https://near-faucet.io (verify at build time)
- Contract account: a testnet dev account created at deploy time (NOT in repo).

## Submission checklist (owner does these at the end)

- [ ] Push repo to public GitHub
- [ ] Record <3 min demo video, post publicly on X
- [ ] Fill submission form: name, description (20-2000 chars), team lead, email,
      team size, track = Agent Economy, NEAR payout address, repo link, X post link
- [ ] Submit before 14 Nov 2026 23:59 UTC
