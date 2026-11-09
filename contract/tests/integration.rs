//! Sandbox integration test for TaskBounty (near-workspaces, in-memory).
//!
//! Runs the full happy path on a local sandbox node — no real network, no
//! real NEAR, no wallet/account is created outside the sandbox:
//!   create_task (1 NEAR bounty) -> claim_task -> submit_proof ->
//!   approve_and_pay, then asserts the agent's balance grew by the bounty
//!   (minus the tiny gas the agent paid for its own claim/proof txs) and
//!   the contract's balance fell by exactly the bounty.
//!
//! Requires the wasm to be built first:
//!   cargo near build
//! (wasm expected at ./target/near/task_bounty.wasm)

use anyhow::Result;
use near_workspaces::types::NearToken;
use serde_json::json;

const WASM_PATH: &str = "./target/near/task_bounty.wasm";
const BOUNTY: NearToken = NearToken::from_near(1);
/// Gas allowance: the agent pays gas for claim + submit_proof; assert the
/// payout is within this slack of the full bounty.
const GAS_SLACK: NearToken = NearToken::from_millinear(50); // 0.05 NEAR

fn load_wasm() -> Vec<u8> {
    match std::fs::read(WASM_PATH) {
        Ok(wasm) => wasm,
        Err(_) => panic!(
            "WASM not found at {WASM_PATH}. Build it first with `cargo near build` \
             (from the contract directory), then re-run this test."
        ),
    }
}

#[tokio::test]
async fn happy_path_create_claim_proof_approve_pays_agent() -> Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let wasm = load_wasm();
    let contract = worker.dev_deploy(&wasm).await?;

    let creator = worker.dev_create_account().await?;
    let agent = worker.dev_create_account().await?;

    // 1. Creator posts a task with a 1 NEAR bounty (escrowed in the contract).
    let outcome = creator
        .call(contract.id(), "create_task")
        .args_json(json!({
            "title": "Summarize this article",
            "description": "https://example.com/article",
            "category": "research",
        }))
        .deposit(BOUNTY)
        .max_gas()
        .transact()
        .await?;
    assert!(outcome.is_success(), "create_task failed: {outcome:?}");

    let task: serde_json::Value = contract
        .view("get_task")
        .args_json(json!({ "task_id": 0 }))
        .await?
        .json()?;
    assert_eq!(task["status"], "Open");
    assert_eq!(task["bounty"], "1000000000000000000000000");
    assert_eq!(task["creator"], creator.id().to_string());

    let count: u64 = contract
        .view("get_task_count")
        .args_json(json!({}))
        .await?
        .json()?;
    assert_eq!(count, 1);

    // 2. Agent claims the task.
    let outcome = agent
        .call(contract.id(), "claim_task")
        .args_json(json!({ "task_id": 0 }))
        .max_gas()
        .transact()
        .await?;
    assert!(outcome.is_success(), "claim_task failed: {outcome:?}");

    let agent_balance_before = agent.view_account().await?.balance;
    let contract_balance_before = contract.view_account().await?.balance;

    // 3. Agent submits proof.
    let outcome = agent
        .call(contract.id(), "submit_proof")
        .args_json(json!({
            "task_id": 0,
            "proof": "Extractive summary: the article says ...",
        }))
        .max_gas()
        .transact()
        .await?;
    assert!(outcome.is_success(), "submit_proof failed: {outcome:?}");

    // 4. Creator approves and the contract pays the bounty to the agent.
    let outcome = creator
        .call(contract.id(), "approve_and_pay")
        .args_json(json!({ "task_id": 0 }))
        .max_gas()
        .transact()
        .await?;
    assert!(outcome.is_success(), "approve_and_pay failed: {outcome:?}");

    let task: serde_json::Value = contract
        .view("get_task")
        .args_json(json!({ "task_id": 0 }))
        .await?
        .json()?;
    assert_eq!(task["status"], "Paid");
    assert_eq!(task["agent"], agent.id().to_string());

    let agent_balance_after = agent.view_account().await?.balance;
    let contract_balance_after = contract.view_account().await?.balance;

    // Agent gained (approximately) the full bounty.
    assert!(
        agent_balance_after > agent_balance_before,
        "agent balance did not increase: before={agent_balance_before}, after={agent_balance_after}"
    );
    let gained = agent_balance_after.as_yoctonear() - agent_balance_before.as_yoctonear();
    assert!(
        gained + GAS_SLACK.as_yoctonear() >= BOUNTY.as_yoctonear(),
        "agent gained {gained} yocto, expected ~{} (bounty) within {GAS_SLACK} slack",
        BOUNTY.as_yoctonear()
    );

    // Contract paid out exactly the bounty (it pays no gas on this path).
    let contract_paid =
        contract_balance_before.as_yoctonear() - contract_balance_after.as_yoctonear();
    assert_eq!(
        contract_paid,
        BOUNTY.as_yoctonear(),
        "contract balance fell by {contract_paid}, expected exactly the bounty"
    );

    Ok(())
}

#[tokio::test]
async fn cancel_refunds_creator_on_sandbox() -> Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let wasm = load_wasm();
    let contract = worker.dev_deploy(&wasm).await?;
    let creator = worker.dev_create_account().await?;

    let creator_before = creator.view_account().await?.balance;

    creator
        .call(contract.id(), "create_task")
        .args_json(json!({
            "title": "Task to cancel",
            "description": "d",
            "category": "text",
        }))
        .deposit(BOUNTY)
        .max_gas()
        .transact()
        .await?
        .into_result()?;

    let outcome = creator
        .call(contract.id(), "cancel_task")
        .args_json(json!({ "task_id": 0 }))
        .max_gas()
        .transact()
        .await?;
    assert!(outcome.is_success(), "cancel_task failed: {outcome:?}");

    let task: serde_json::Value = contract
        .view("get_task")
        .args_json(json!({ "task_id": 0 }))
        .await?
        .json()?;
    assert_eq!(task["status"], "Cancelled");

    // Creator got the bounty back (minus gas for the two txs they signed).
    let creator_after = creator.view_account().await?.balance;
    assert!(
        creator_after.as_yoctonear() + GAS_SLACK.as_yoctonear()
            >= creator_before.as_yoctonear(),
        "creator balance after cancel {creator_after} is more than {GAS_SLACK} below before {creator_before}"
    );

    Ok(())
}
