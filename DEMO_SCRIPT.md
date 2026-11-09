# TaskBounty — demo video script (< 3 minutes)

Target: under 3:00. Record the screen + voiceover. No editing tricks needed —
everything below is real: the deployed testnet contract, the live worker, and
real on-chain state. (Do NOT record the video — this is the script only.)

Contract (testnet): `taskbounty-75c73ec3.testnet`
Demo task used in the smoke test: #1 "Summarise the NEAR hackathon
announcement" — 0.1 NEAR bounty, status `Paid`.

## Setup before recording

1. `cd frontend && npm run dev` — open http://localhost:5173.
2. Connect MyNearWallet (testnet) with the creator account
   (`taskbounty-75c73ec3.testnet` — needs testnet NEAR; faucet:
   https://near-faucet.io). If the wallet is not connected, show the
   read-only task list first — it works without a wallet.
3. Have a terminal ready in `~/workspace/near-hackathon/worker` for
   `npm run once`.
4. Have https://explorer.testnet.near.org open for the two tx hashes:
   create `FXh74Sigp6WeqaRDu3ASnwaHTqDn5cnn1JepKRsdsZHQ`,
   approve `CGSPdwPxzVTypTj7wMMRfx6N2kptEndG21r7zawuhvpJ`.

## Script

### 0:00–0:20 — The problem + the idea (show the app, task list)

> "Hiring an AI agent today means trusting a middleman with your money.
> TaskBounty fixes that: you post a task and lock the bounty in a smart
> contract on NEAR. The agent only gets paid when you approve its work —
> no middleman, no trust needed."

Show: the TaskBounty task list (Open tasks, bounties in NEAR).

### 0:20–0:50 — Post a task (show the form + wallet approval)

> "I post a research task — summarise the NEAR hackathon announcement —
> with a 0.1 NEAR bounty. The bounty is locked in escrow by the contract
> the moment I post."

Show: fill in title/description/category, set bounty 0.1 NEAR, sign with
MyNearWallet. The new task appears as Open. (If you re-record this live,
use a fresh task — the smoke-test task #1 is already Paid.)

### 0:50–1:40 — The AI agent does the work (show the worker terminal)

> "Now the demo agent — a small Node worker — picks it up. It only does
> research tasks, and it writes an extractive summary: sentences copied
> verbatim from the source, no LLM, nothing invented."

Show: run `npm run once` in the worker terminal. It lists the Open task,
claims it, fetches the NEAR blog page, and submits the proof. Cut to the
app: the task now shows ProofSubmitted with the summary visible.

> "If the page had too little text, the worker skips the task instead of
> faking a summary. That happened in our first test run — and it's by
> design."

### 1:40–2:20 — Approve and pay (show approve + explorer)

> "I read the proof, and it's good — so I approve. The contract releases
> the 0.1 NEAR straight to the agent's wallet."

Show: click Approve & Pay, sign, task flips to Paid. Show the agent's
balance on the explorer: 10.0000 → 10.0996 NEAR (0.1 bounty minus gas).
Show the two transactions on explorer.testnet.near.org.

### 2:20–2:50 — What it is, honestly (show the repo / README)

> "Everything is real and on NEAR testnet: the Rust escrow contract, the
> worker, the frontend. One honest note: payouts are plain NEAR transfers
> in the same contract — NEAR Intents is for cross-chain swaps, and it
> would add nothing here, so we didn't fake an integration. The code is
> public on GitHub — link in the description."

Show: the repo README (architecture diagram, real-vs-demo table).

### 2:50–3:00 — Close

> "TaskBounty — pay per task, only when the work is done. Built for the
> NEAR Hackathon, Agent Economies track."

## Notes for the presenter

- If a live step is slow (wallet approval, RPC), keep the take — a few
  seconds of waiting reads as honest, not broken. Don't re-record to hide it.
- Never show a private key on screen. The `.env` and `.near-credentials/`
  files are gitignored for a reason — keep terminals away from them.
- The demo uses testnet NEAR only (no real value). Say so once, in the
  approve segment, if it fits.
