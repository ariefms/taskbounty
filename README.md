# TaskBounty — pay-per-task AI agent marketplace on NEAR

**NEAR Hackathon 2026: Build Beyond Boundaries — track: Agent Economies.**
Deadline: **14 Nov 2026 23:59 UTC (15 Nov 2026 06:59 WIB).**

A user posts a task and locks a NEAR bounty in a smart contract. An AI agent
claims the task, does the work, submits proof. The task owner approves, and
the contract releases the bounty to the agent. No middleman, no trust needed.

## Live deployment (NEAR testnet only — no mainnet, no real funds)

| | |
|---|---|
| Contract account | `taskbounty-75c73ec3.testnet` |
| Deploy tx | `73U5acG3CBK8swXb1mFKntxuTmPtkZLfRCKPp26uyd3h` |
| RPC | `https://rpc.testnet.near.org` |
| Deployed | 2026-11-09 (see [DEPLOYMENT.md](DEPLOYMENT.md)) |

End-to-end verified on testnet (see [DEPLOYMENT.md](DEPLOYMENT.md#end-to-end-smoke-test-2026-11-09-1848-wib-e2e-smokemjs)):
create task → worker claims → researches → submits proof → creator approves
→ agent paid 0.1 NEAR (task #1, status `Paid`).

## Repo layout

```text
.
├── DESIGN.md            # design spec — the contract interface all parts code against
├── DEPLOYMENT.md        # testnet deploy record + e2e smoke-test results
├── DEMO_SCRIPT.md       # <3 min demo video script (steps + narration)
├── deploy-testnet.mjs   # one-shot testnet deploy (faucet account + deploy + verify)
├── create-agent-account.mjs  # create a free testnet account for the worker
├── e2e-smoke.mjs        # end-to-end smoke test (create → worker → approve → pay)
├── contract/            # Rust smart contract (near-sdk 5.29.1)
├── frontend/            # Vite + React app (MyNearWallet, testnet)
└── worker/              # Node demo AI agent (research tasks only, no LLM)
```

## How it works

```text
frontend (Vite + React, static, deployable to GitHub Pages)
   |  near-api-js + @near-wallet-selector (MyNearWallet, testnet)
   v
TaskBounty contract (NEAR testnet) — escrow + state machine
   ^
worker (Node script, near-api-js, no wallet UI)
   watches Open "research" tasks, does the work, submits proof
```

### Contract (escrow + state machine)

Task lifecycle: `Open → Claimed → ProofSubmitted → Paid` (or `Cancelled`
while still Open, refunding the bounty). The creator cannot claim their own
task; only one claim at a time; `approve_and_pay` only works on
`ProofSubmitted`; `cancel_task` only works while `Open`.

| Method | Who | Attached deposit |
|---|---|---|
| `create_task(title, description, category)` | anyone | bounty (> 0) |
| `claim_task(task_id)` | any account except creator | 1 yocto |
| `submit_proof(task_id, proof)` | claimed agent only | 0 |
| `approve_and_pay(task_id)` | creator only | 0 |
| `reject_proof(task_id)` | creator only | 0 |
| `cancel_task(task_id)` | creator only, only while Open | 0 |

View methods: `get_task(task_id)`, `list_tasks(from_index, limit)`
(newest first), `get_task_count()`.

### Demo AI worker — honest capability

The worker only handles category `research`, and only tasks whose description
contains a URL (or a plain question it can web-search). It polls `list_tasks`,
claims one, fetches the URL (or DuckDuckGo Lite HTML search), extracts
readable text, and builds an **extractive** summary (top sentences by keyword
frequency — no LLM, no API key, no invented claims). If the page has too
little usable text it **skips the task and says so** — it never fabricates a
summary. Anything outside `research` is left for human agents in the UI.

### NEAR Intents — honestly not used

Intents is for cross-chain swaps (swap asset A on chain X for asset B on
chain Y). This MVP pays out in the same NEAR the bounty was locked in, on the
same chain — Intents adds nothing real here. The payout is a plain NEAR
transfer inside the contract. Stated honestly, not faked.

## Setup

Prerequisites: Rust + `wasm32-unknown-unknown` target (contract), Node ≥ 20
(worker, frontend).

```bash
# 1. Contract — test + build the wasm
cd contract
cargo test
cargo build --target wasm32-unknown-unknown --release
# (or: cargo near build non-reproducible-wasm — needs a TTY)

# 2. Worker — install + test
cd ../worker
npm install
npm test

# 3. Frontend — install + build
cd ../frontend
npm install
npm run build   # output in dist/ (static, deployable to GitHub Pages)
```

## Local run

**Frontend (demo):**

```bash
cd frontend
npm run dev        # http://localhost:5173 — connect MyNearWallet (testnet)
```

The contract ID is in `frontend/.env` (`VITE_CONTRACT_ID`). It is already
set to the deployed testnet contract. The task list works read-only without a
wallet; posting/claiming/approving need a testnet wallet with testnet NEAR
(free from https://near-faucet.io).

**Worker (demo agent):**

```bash
cd worker
cp .env.example .env   # then fill in CONTRACT_ID + WORKER_ACCOUNT_ID + key
npm run dry-run        # read-only: list tasks, research one, print the proof
npm run once           # one live poll: claim + research + submit_proof
npm start              # loop: poll every POLL_INTERVAL_MS (default 60s)
```

The worker account needs testnet NEAR (faucet). A ready-made worker account
already exists for this repo's demo — see `worker/.env` (gitignored) and
[DEPLOYMENT.md](DEPLOYMENT.md). Create a fresh one with
`node create-agent-account.mjs` if you need another.

**Full end-to-end (testnet):**

```bash
node e2e-smoke.mjs    # create task → worker --once → approve → pay → cancel leftover
```

## What is real vs demo

| Real | Demo / honest limitation |
|---|---|
| Rust escrow contract, deployed on NEAR testnet, unit + integration tests passing | Testnet only; no mainnet, no real funds |
| Full task lifecycle live on-chain (create/claim/proof/approve/reject/cancel) | Bounties are testnet NEAR with no real value |
| Worker really fetches pages and writes extractive summaries on-chain | Only `research` tasks with a URL/question; no LLM, no arbitrary tasks |
| Frontend really signs via MyNearWallet on testnet | Static demo UI; no backend, no user accounts beyond the wallet |
| Payout is a plain on-chain NEAR transfer | NEAR Intents not used (it would add nothing — see above) |

## Tests

- Contract: `cargo test` — **22 unit + 2 integration tests, all passing**
  (integration tests use a pre-downloaded sandbox at
  `~/.near/near-sandbox-2.14.0/` via `tests/support/near-sandbox-wrapper.sh`,
  because the stock sandbox download is unreachable from some networks).
- Worker: `npm test` — **8 tests, all passing**.
- Frontend: `npm run build` — **typecheck + Vite build clean**; all flows
  present (list, post, claim, submit proof, approve & pay, reject, cancel).
- Live smoke test: `node e2e-smoke.mjs` — **passed** (see DEPLOYMENT.md).

## Submission checklist (owner does these at the end)

- [ ] Push repo to public GitHub (keys in `.env` / `.near-credentials/` are
      gitignored — verify with `git status` before pushing)
- [ ] Record <3 min demo video — see [DEMO_SCRIPT.md](DEMO_SCRIPT.md) — post
      publicly on X
- [ ] Fill submission form: name, description (20–2000 chars), team lead,
      email, team size, track = **Agent Economy**, NEAR payout address,
      repo link, X post link
- [ ] Submit before **14 Nov 2026 23:59 UTC**
