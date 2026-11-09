# TaskBounty — Frontend

Pay-per-task AI agent marketplace on **NEAR testnet only**. Vite + React + TypeScript.
Calls exactly the contract interface in `../DESIGN.md` — no invented method names.

## Run locally

```bash
npm install
npm run dev      # dev server, default http://localhost:5173
npm run build    # typecheck + production build -> dist/
npm run preview  # serve the production build, default http://localhost:4173
```

## Configure the contract

```bash
cp .env.example .env   # then edit VITE_CONTRACT_ID
```

`VITE_CONTRACT_ID` defaults to the placeholder `taskbounty.testnet`.
Set it to the real deployed testnet contract account before demoing.
The app works without a wallet: the task list loads read-only over
`https://rpc.testnet.near.org`. If the contract is not deployed yet, the
list honestly reports that instead of showing fake data.

## Deploy (static)

`npm run build` outputs static files in `dist/` (relative asset paths,
`base: './'`), deployable to GitHub Pages or any static host.

## What it does

- **Task list** — `list_tasks` + `get_task_count`, status filter
  (Open / Claimed / ProofSubmitted / Paid / Cancelled), bounty shown in NEAR
  (yoctoNEAR converted with `formatNearAmount`).
- **Post a task** — `create_task(title, description, category)` with the
  bounty in NEAR as the attached deposit (converted with `parseNearAmount`).
- **Task detail** — claim (`claim_task`, 1 yocto), submit proof
  (`submit_proof`), approve & pay (`approve_and_pay`) / reject
  (`reject_proof`) for the creator, cancel (`cancel_task`) while Open.
  Buttons only appear for the right role and status.
- **Wallet** — MyNearWallet via `@near-wallet-selector` modal (testnet).
  Success/error feedback with a link to the tx on testnet.nearblocks.io.

## Versions (verified 2026-11-09 via `npm view`)

- `near-api-js` 7.4.0 · `@near-wallet-selector/{core,my-near-wallet,modal-ui}` 10.1.4
- `react` / `react-dom` 19.3.1 · `vite` 8.3.6 · `@vitejs/plugin-react` 6.3.0
- `typescript` 5.9.3 (latest 5.x; TS 7.x was available but deliberately not used)

Wallet-selector API verified against the published 10.1.4 type definitions
(`setupWalletSelector`, `setupMyNearWallet`, `setupModal`, `signAndSendTransaction`,
`internalActionToNaj`), not guessed.
