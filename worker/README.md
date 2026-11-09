# TaskBounty worker — demo AI agent (NEAR testnet)

Watches the TaskBounty contract for Open tasks of category `research`, claims
one, does the work, and submits proof. Built against the interface in
`../DESIGN.md` — view `list_tasks`, change `claim_task` / `submit_proof`.
No other method names are used.

## What it actually does (honest limits)

- **Research category only.** Tasks in any other category are ignored.
- **URL or plain question only.** It fetches the URL in the description, or —
  if there is no URL — web-searches the question via DuckDuckGo Lite HTML
  (`https://lite.duckduckgo.com/lite/`) and fetches the top result.
- **Extractive summary only.** The proof is the top 5 sentences from the
  fetched page, ranked by keyword frequency, copied verbatim. **No LLM, no
  API key, no paraphrasing, no invented facts.** If the fetch fails or the
  page yields no usable text, the task is skipped and the reason is logged —
  a summary is never fabricated.
- **Extractive, not polished.** Sentences are verbatim from the page, so on
  JS-heavy/marketing pages a sentence can carry a nav fragment or a reference
  leftover (the extractor strips scripts, styles, headings, citations and
  duplicates, but it is not a full reader-mode parser). What it never does is
  invent content.
- **One task per poll**, in loop mode.

It does not pretend to do arbitrary tasks. Anything outside `research` is left
for human agents in the UI. Payout is a plain NEAR transfer inside the
contract (see DESIGN.md on why NEAR Intents adds nothing here).

## Setup

Requires Node 20+ (developed on Node 24).

```bash
cd worker
npm install
cp .env.example .env   # then fill in CONTRACT_ID etc.
```

**Testnet only.** `NEAR_NETWORK` must be `testnet`; any other value is refused
at startup. No mainnet, no real funds, nothing is deployed by this worker.

### Credentials

- `WORKER_ACCOUNT_ID` — a testnet account you control (fund it at
  https://near-faucet.io).
- Private key — prefer `WORKER_KEY_FILE` (path to a file holding the
  `ed25519:...` key, or a `{"private_key": "..."}` JSON file) over
  `WORKER_PRIVATE_KEY` in `.env`. **Never commit `.env` or any key file**
  — `.env` is gitignored. No account or wallet is created by this project.

## Usage

```bash
npm run dry-run   # node src/index.js --dry-run
npm run once      # node src/index.js --once
npm start         # node src/index.js --loop
```

| Mode | What happens |
|---|---|
| `--dry-run` | Read-only. Lists tasks, picks one Open research task, fetches + summarises, prints exactly what WOULD be submitted. **Works with no account/key at all** and signs nothing. |
| `--once` | One live poll: claim the task, research it, `submit_proof`. Needs account + key. |
| `--loop` | Polls every `POLL_INTERVAL_MS` (default 60000), at most one task per poll. Errors are logged; the loop keeps running. |

## Env vars

| Var | Default | Notes |
|---|---|---|
| `CONTRACT_ID` | — (required) | TaskBounty contract on testnet |
| `WORKER_ACCOUNT_ID` | — | Live modes only |
| `WORKER_PRIVATE_KEY` | — | `ed25519:...` string; live modes only |
| `WORKER_KEY_FILE` | — | Path to key file; alternative to the above |
| `NEAR_NETWORK` | `testnet` | Must stay `testnet` |
| `RPC_URL` | `https://rpc.testnet.near.org` | |
| `POLL_INTERVAL_MS` | `60000` | Loop mode only |
| `FETCH_TIMEOUT_MS` | `10000` | Per page-fetch timeout |

## Tests

```bash
npm test   # node --test test/*.test.js — extractive summariser + HTML extractor
```

## Stack

Plain Node.js + `near-api-js` v7.4.0 (verified via `npm view near-api-js
version`). View calls use `provider.callFunction({ contractId, method,
args })`; change calls use `new Account(accountId, provider, privateKey)` +
`account.callFunction({ contractId, methodName, args, gas, deposit })`.
No other dependencies.
