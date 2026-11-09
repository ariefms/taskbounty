# TaskBounty — Testnet Deployment

## Deployment (NEAR testnet only — no mainnet, no real funds)

| Field | Value |
|---|---|
| Contract account | `taskbounty-75c73ec3.testnet` |
| Deploy transaction hash | `73U5acG3CBK8swXb1mFKntxuTmPtkZLfRCKPp26uyd3h` |
| RPC used | `https://rpc.testnet.near.org` |
| Deployed | 2026-11-09 18:44 WIB (11:44 UTC) |
| Wasm deployed | `contract/target/near/task_bounty.wasm` (127,780 bytes) |
| Wasm SHA-256 (hex) | `9c806eca282ba19d4c88c8545321a8fb4735ade147229acac8c5a0eaa4b1cf36` |
| Wasm SHA-256 (base58) | `BXvBsZsfHPuGBmXddix5oUvQ9YMvzsw9JjMU9vqaJ67o` |
| Release wasm (plain cargo build) | `contract/target/wasm32-unknown-unknown/release/task_bounty.wasm` (241,907 bytes) |

## Verification

- View call `get_task_count` on the deployed contract returned `0` (fresh contract, no tasks yet) — 2026-11-09 18:44 WIB.
- On-chain code hash (`view_code` via RPC) is `BXvBsZsfHPuGBmXddix5oUvQ9YMvzsw9JjMU9vqaJ67o` — matches the built wasm checksum exactly.

## Account & key

- Dev account created free via the testnet helper/faucet (`POST https://helper.testnet.near.org/account`, HTTP 200, no captcha needed).
- Public key: `ed25519:tkCEEMpR88nT3RFYMN8BSU6wKHQHAGtAv9W6ieKM3nn`
- Private key: `contract/.near-credentials/testnet/taskbounty-75c73ec3.testnet.json` (chmod 600, gitignored via `.near-credentials/` in the repo root `.gitignore`). **Never commit or share it.**

## Tests (2026-11-09, before deploy)

- `cargo test --lib`: **22 passed, 0 failed** (unit tests in `src/lib.rs`).
- `cargo test --test integration`: **2 passed, 0 failed** (sandbox: happy-path payout + cancel refund).
- Sandbox note: `near-workspaces`' stock S3 download is unreachable from this VM; the integration tests use the pre-downloaded sandbox at `~/.near/near-sandbox-2.14.0/near-sandbox` via `tests/support/near-sandbox-wrapper.sh` (`NEAR_SANDBOX_BIN_PATH`). See `contract/tests/support/README.md`.

## Deploy script

`deploy-testnet.mjs` (repo root) — creates a fresh dev account via the helper, saves the key, deploys with near-api-js v7 (`Account.deployContract`), then runs the `get_task_count` view call. Re-run with `EXISTING_ACCOUNT=<account>.testnet` to redeploy to the same account.

## End-to-end smoke test (2026-11-09 ~18:48 WIB, `e2e-smoke.mjs`)

Full flow verified live on testnet — create → claim → research → proof → approve → pay:

| Step | Result |
|---|---|
| Creator posts research task #1 (0.1 NEAR bounty, NEAR hackathon blog URL) | tx `FXh74Sigp6WeqaRDu3ASnwaHTqDn5cnn1JepKRsdsZHQ`, status Open |
| Worker (`taskbounty-agent-96c9722a.testnet`) runs `--once` | researched the blog page (5,810 chars → 5-sentence extractive summary), claimed, submitted proof (999 chars), status ProofSubmitted |
| Creator `approve_and_pay` | tx `CGSPdwPxzVTypTj7wMMRfx6N2kptEndG21r7zawuhvpJ`, status Paid |
| Agent balance | 10.0000 → 10.0996 NEAR (0.1 bounty − ~0.0004 gas) |
| Leftover task #0 cancelled | tx `FPv5qmshKYPb6dmhEftQY2DLDRMrdoML4Ef1eaHXG4KE`, status Cancelled |

Worker account created free via the same helper faucet (`create-agent-account.mjs`); key at `worker/.near-credentials/testnet/taskbounty-agent-96c9722a.testnet.json` (chmod 600, gitignored). **Never commit or share it.**

Note from the first smoke run: the worker honestly SKIPPED a task pointing at `https://example.com` ("no usable text", 171 chars) — it never fabricates a summary. The smoke task was re-pointed at the longer NEAR hackathon blog post, which it summarised correctly.
