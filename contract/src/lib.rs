//! TaskBounty — pay-per-task AI agent marketplace on NEAR.
//!
//! A user posts a task and locks a NEAR bounty in escrow. An agent claims
//! the task, does the work, submits proof. The creator approves and the
//! contract releases the bounty to the agent via a cross-contract `Promise`
//! transfer. No middleman, no trust needed.
//!
//! Interface implemented exactly per `../DESIGN.md`:
//!   change: create_task (payable), claim_task, submit_proof,
//!           approve_and_pay, reject_proof, cancel_task
//!   view:   get_task, list_tasks (newest first), get_task_count
//!
//! Amounts are yoctoNEAR. `create_task` locks the attached deposit as the
//! bounty; `approve_and_pay` transfers it to the agent; `cancel_task`
//! refunds it to the creator. State machine:
//!   Open -> Claimed -> ProofSubmitted -> Paid
//!   ProofSubmitted -> Claimed (on reject)
//!   Open -> Cancelled (on cancel, creator only, while still Open)

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, NearToken, Promise};

/// Maximum attached deposit (beyond the bounty) accepted by the
/// zero-deposit change methods. The classic NEAR convention is 1 yoctoNEAR;
/// the DESIGN.md spec writes these as "0 (1 yocto)".
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

/// Default page size for `list_tasks` when `limit` is not given.
const DEFAULT_LIST_LIMIT: u64 = 50;
/// Hard cap for `list_tasks` so a single view call cannot blow the gas limit.
const MAX_LIST_LIMIT: u64 = 100;

/// Task lifecycle status. Serializes to JSON as the variant name
/// ("Open" | "Claimed" | "ProofSubmitted" | "Paid" | "Cancelled").
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TaskStatus {
    Open,
    Claimed,
    ProofSubmitted,
    Paid,
    Cancelled,
}

/// A posted task. Field names and types follow `../DESIGN.md` exactly.
#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq)]
pub struct Task {
    pub id: u64,
    pub creator: AccountId,
    pub agent: Option<AccountId>,
    pub title: String,
    pub description: String,
    pub category: String,
    pub bounty: U128,
    pub status: TaskStatus,
    pub proof: Option<String>,
    pub created_at: u64,
}

#[near(contract_state)]
pub struct TaskBounty {
    tasks: LookupMap<u64, Task>,
    task_count: u64,
}

// LookupMap has no Default in near-sdk 5.29.1, so initialize it explicitly.
impl Default for TaskBounty {
    fn default() -> Self {
        Self { tasks: LookupMap::new(b"t"), task_count: 0 }
    }
}

#[near]
impl TaskBounty {
    /// Create a task, locking the attached deposit as the bounty.
    /// Attached deposit must be > 0. Status starts `Open`.
    #[payable]
    pub fn create_task(
        &mut self,
        title: String,
        description: String,
        category: String,
    ) -> Task {
        let bounty = env::attached_deposit();
        assert!(
            bounty.as_yoctonear() > 0,
            "Bounty must be greater than 0: attach a NEAR deposit"
        );
        let id = self.task_count;
        let task = Task {
            id,
            creator: env::predecessor_account_id(),
            agent: None,
            title,
            description,
            category,
            bounty: U128(bounty.as_yoctonear()),
            status: TaskStatus::Open,
            proof: None,
            created_at: env::block_timestamp(),
        };
        self.tasks.insert(id, task.clone());
        self.task_count += 1;
        task
    }

    /// Claim an open task. Any account except the creator. One claim at a
    /// time: `Open -> Claimed`.
    #[payable]
    pub fn claim_task(&mut self, task_id: u64) {
        Self::assert_at_most_one_yocto();
        let mut task = self.task_or_panic(task_id);
        assert_eq!(task.status, TaskStatus::Open, "Task is not open");
        let caller = env::predecessor_account_id();
        assert_ne!(caller, task.creator, "Creator cannot claim their own task");
        task.agent = Some(caller);
        task.status = TaskStatus::Claimed;
        self.tasks.insert(task_id, task);
    }

    /// Submit proof of completed work. Claimed agent only.
    /// `Claimed -> ProofSubmitted`.
    #[payable]
    pub fn submit_proof(&mut self, task_id: u64, proof: String) {
        Self::assert_at_most_one_yocto();
        let mut task = self.task_or_panic(task_id);
        assert_eq!(
            task.status,
            TaskStatus::Claimed,
            "Task is not in Claimed state"
        );
        let caller = env::predecessor_account_id();
        assert_eq!(
            task.agent,
            Some(caller),
            "Only the claimed agent can submit proof"
        );
        task.proof = Some(proof);
        task.status = TaskStatus::ProofSubmitted;
        self.tasks.insert(task_id, task);
    }

    /// Approve the submitted proof and release the escrowed bounty to the
    /// agent via a cross-contract `Promise` transfer. Creator only, and
    /// only while status is `ProofSubmitted`. `ProofSubmitted -> Paid`.
    ///
    /// The status is set to `Paid` before the transfer is scheduled
    /// (checks-effects-interactions), so the bounty can never be paid twice.
    #[payable]
    pub fn approve_and_pay(&mut self, task_id: u64) -> Promise {
        Self::assert_at_most_one_yocto();
        let mut task = self.task_or_panic(task_id);
        assert_eq!(
            env::predecessor_account_id(),
            task.creator,
            "Only the creator can approve and pay"
        );
        assert_eq!(
            task.status,
            TaskStatus::ProofSubmitted,
            "No proof submitted to approve"
        );
        let agent = task
            .agent
            .clone()
            .expect("ProofSubmitted task must have an agent");
        let bounty = NearToken::from_yoctonear(task.bounty.0);
        task.status = TaskStatus::Paid;
        self.tasks.insert(task_id, task);
        Promise::new(agent).transfer(bounty)
    }

    /// Reject the submitted proof. Creator only, only while
    /// `ProofSubmitted`. `ProofSubmitted -> Claimed`; the stored proof is
    /// cleared so the agent may resubmit fresh work.
    #[payable]
    pub fn reject_proof(&mut self, task_id: u64) {
        Self::assert_at_most_one_yocto();
        let mut task = self.task_or_panic(task_id);
        assert_eq!(
            env::predecessor_account_id(),
            task.creator,
            "Only the creator can reject proof"
        );
        assert_eq!(
            task.status,
            TaskStatus::ProofSubmitted,
            "No proof submitted to reject"
        );
        task.status = TaskStatus::Claimed;
        task.proof = None;
        self.tasks.insert(task_id, task);
    }

    /// Cancel an open task and refund the bounty to the creator.
    /// Creator only, only while `Open`. `Open -> Cancelled`.
    #[payable]
    pub fn cancel_task(&mut self, task_id: u64) -> Promise {
        Self::assert_at_most_one_yocto();
        let mut task = self.task_or_panic(task_id);
        assert_eq!(
            env::predecessor_account_id(),
            task.creator,
            "Only the creator can cancel the task"
        );
        assert_eq!(
            task.status,
            TaskStatus::Open,
            "Only an open (unclaimed) task can be cancelled"
        );
        let creator = task.creator.clone();
        let bounty = NearToken::from_yoctonear(task.bounty.0);
        task.status = TaskStatus::Cancelled;
        self.tasks.insert(task_id, task);
        Promise::new(creator).transfer(bounty)
    }

    /// Fetch one task by id, or `None` if it does not exist.
    pub fn get_task(&self, task_id: u64) -> Option<Task> {
        self.tasks.get(&task_id).cloned()
    }

    /// List tasks newest first. `from_index` skips that many tasks from the
    /// newest end; `limit` defaults to 50 and is capped at 100.
    pub fn list_tasks(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Task> {
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(DEFAULT_LIST_LIMIT).min(MAX_LIST_LIMIT);
        let mut out = Vec::new();
        if self.task_count == 0 || limit == 0 {
            return out;
        }
        // Walk ids newest -> oldest, skipping `from`, taking `limit`.
        let mut skipped: u64 = 0;
        let mut id = self.task_count;
        while id > 0 {
            id -= 1;
            if skipped < from {
                skipped += 1;
                continue;
            }
            if (out.len() as u64) >= limit {
                break;
            }
            if let Some(task) = self.tasks.get(&id) {
                out.push(task.clone());
            }
        }
        out
    }

    /// Total number of tasks ever created (including Paid/Cancelled ones).
    pub fn get_task_count(&self) -> u64 {
        self.task_count
    }
}

impl TaskBounty {
    fn task_or_panic(&self, task_id: u64) -> Task {
        self.tasks
            .get(&task_id)
            .cloned()
            .unwrap_or_else(|| panic!("Task {} does not exist", task_id))
    }

    /// Zero-deposit change methods accept at most 1 yoctoNEAR (DESIGN.md:
    /// "0 (1 yocto)"), so callers using either convention succeed, while a
    /// real deposit can never be locked in the contract by accident.
    fn assert_at_most_one_yocto() {
        assert!(
            env::attached_deposit() <= ONE_YOCTO,
            "This method accepts at most 1 yoctoNEAR attached deposit"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const ONE_NEAR: NearToken = NearToken::from_near(1);

    fn ctx(predecessor: AccountId, deposit: NearToken) -> near_sdk::VMContext {
        VMContextBuilder::new()
            .predecessor_account_id(predecessor)
            .attached_deposit(deposit)
            .build()
    }

    fn setup() -> TaskBounty {
        testing_env!(ctx(accounts(0), NearToken::from_yoctonear(0)));
        TaskBounty::default()
    }

    /// Create one open task (id 0, 1 NEAR bounty) as accounts(0).
    fn create_open_task(contract: &mut TaskBounty) -> Task {
        testing_env!(ctx(accounts(0), ONE_NEAR));
        contract.create_task(
            "Summarize this article".to_string(),
            "https://example.com/article".to_string(),
            "research".to_string(),
        )
    }

    /// Drive a task to ProofSubmitted: created by accounts(0), claimed by
    /// accounts(1), proof submitted by accounts(1).
    fn task_with_proof(contract: &mut TaskBounty) -> Task {
        create_open_task(contract);
        testing_env!(ctx(accounts(1), NearToken::from_yoctonear(0)));
        contract.claim_task(0);
        testing_env!(ctx(accounts(1), NearToken::from_yoctonear(0)));
        contract.submit_proof(0, "Summary: ...".to_string());
        contract.get_task(0).unwrap()
    }

    #[test]
    fn create_task_locks_bounty_in_escrow() {
        let mut contract = setup();
        let task = create_open_task(&mut contract);
        assert_eq!(task.id, 0);
        assert_eq!(task.creator, accounts(0));
        assert_eq!(task.agent, None);
        assert_eq!(task.title, "Summarize this article");
        assert_eq!(task.category, "research");
        assert_eq!(task.bounty, U128(ONE_NEAR.as_yoctonear()));
        assert_eq!(task.status, TaskStatus::Open);
        assert_eq!(task.proof, None);
        assert_eq!(contract.get_task_count(), 1);
        assert_eq!(contract.get_task(0), Some(task));
    }

    #[test]
    #[should_panic(expected = "Bounty must be greater than 0")]
    fn create_task_rejects_zero_bounty() {
        let mut contract = setup();
        testing_env!(ctx(accounts(0), NearToken::from_yoctonear(0)));
        contract.create_task("t".into(), "d".into(), "text".into());
    }

    #[test]
    fn claim_task_records_agent() {
        let mut contract = setup();
        create_open_task(&mut contract);
        testing_env!(ctx(accounts(1), NearToken::from_yoctonear(0)));
        contract.claim_task(0);
        let task = contract.get_task(0).unwrap();
        assert_eq!(task.status, TaskStatus::Claimed);
        assert_eq!(task.agent, Some(accounts(1)));
    }

    #[test]
    #[should_panic(expected = "Creator cannot claim their own task")]
    fn creator_cannot_claim_own_task() {
        let mut contract = setup();
        create_open_task(&mut contract);
        testing_env!(ctx(accounts(0), NearToken::from_yoctonear(0)));
        contract.claim_task(0);
    }

    #[test]
    #[should_panic(expected = "Task is not open")]
    fn double_claim_fails() {
        let mut contract = setup();
        create_open_task(&mut contract);
        testing_env!(ctx(accounts(1), NearToken::from_yoctonear(0)));
        contract.claim_task(0);
        testing_env!(ctx(accounts(2), NearToken::from_yoctonear(0)));
        contract.claim_task(0);
    }

    #[test]
    #[should_panic(expected = "Task 99 does not exist")]
    fn claim_missing_task_fails() {
        let mut contract = setup();
        testing_env!(ctx(accounts(1), NearToken::from_yoctonear(0)));
        contract.claim_task(99);
    }

    #[test]
    fn submit_proof_stores_proof() {
        let mut contract = setup();
        let task = task_with_proof(&mut contract);
        assert_eq!(task.status, TaskStatus::ProofSubmitted);
        assert_eq!(task.proof, Some("Summary: ...".to_string()));
        assert_eq!(task.agent, Some(accounts(1)));
    }

    #[test]
    #[should_panic(expected = "Only the claimed agent can submit proof")]
    fn only_claimed_agent_can_submit_proof() {
        let mut contract = setup();
        create_open_task(&mut contract);
        testing_env!(ctx(accounts(1), NearToken::from_yoctonear(0)));
        contract.claim_task(0);
        // accounts(2) never claimed; creator (0) also may not submit.
        testing_env!(ctx(accounts(2), NearToken::from_yoctonear(0)));
        contract.submit_proof(0, "fake proof".into());
    }

    #[test]
    #[should_panic(expected = "Task is not in Claimed state")]
    fn submit_proof_before_claim_fails() {
        let mut contract = setup();
        create_open_task(&mut contract);
        testing_env!(ctx(accounts(1), NearToken::from_yoctonear(0)));
        contract.submit_proof(0, "too early".into());
    }

    #[test]
    fn approve_and_pay_marks_paid() {
        let mut contract = setup();
        task_with_proof(&mut contract);
        testing_env!(ctx(accounts(0), NearToken::from_yoctonear(0)));
        // In unit tests the mocked env records the Promise transfer; the
        // actual yoctoNEAR movement is asserted in the sandbox integration
        // test (tests/integration.rs).
        let _ = contract.approve_and_pay(0);
        let task = contract.get_task(0).unwrap();
        assert_eq!(task.status, TaskStatus::Paid);
        assert_eq!(task.agent, Some(accounts(1)));
    }

    #[test]
    #[should_panic(expected = "No proof submitted to approve")]
    fn approve_without_proof_fails() {
        let mut contract = setup();
        create_open_task(&mut contract);
        testing_env!(ctx(accounts(1), NearToken::from_yoctonear(0)));
        contract.claim_task(0);
        testing_env!(ctx(accounts(0), NearToken::from_yoctonear(0)));
        contract.approve_and_pay(0);
    }

    #[test]
    #[should_panic(expected = "Only the creator can approve and pay")]
    fn approve_by_non_creator_fails() {
        let mut contract = setup();
        task_with_proof(&mut contract);
        testing_env!(ctx(accounts(1), NearToken::from_yoctonear(0)));
        contract.approve_and_pay(0);
    }

    #[test]
    #[should_panic(expected = "No proof submitted to approve")]
    fn double_approve_fails() {
        let mut contract = setup();
        task_with_proof(&mut contract);
        testing_env!(ctx(accounts(0), NearToken::from_yoctonear(0)));
        contract.approve_and_pay(0);
        testing_env!(ctx(accounts(0), NearToken::from_yoctonear(0)));
        contract.approve_and_pay(0);
    }

    #[test]
    fn reject_proof_returns_to_claimed() {
        let mut contract = setup();
        task_with_proof(&mut contract);
        testing_env!(ctx(accounts(0), NearToken::from_yoctonear(0)));
        contract.reject_proof(0);
        let task = contract.get_task(0).unwrap();
        assert_eq!(task.status, TaskStatus::Claimed);
        assert_eq!(task.proof, None);
        assert_eq!(task.agent, Some(accounts(1)));
        // Agent may resubmit.
        testing_env!(ctx(accounts(1), NearToken::from_yoctonear(0)));
        contract.submit_proof(0, "Revised summary".into());
        let task = contract.get_task(0).unwrap();
        assert_eq!(task.status, TaskStatus::ProofSubmitted);
        assert_eq!(task.proof, Some("Revised summary".to_string()));
    }

    #[test]
    #[should_panic(expected = "Only the creator can reject proof")]
    fn reject_by_non_creator_fails() {
        let mut contract = setup();
        task_with_proof(&mut contract);
        testing_env!(ctx(accounts(1), NearToken::from_yoctonear(0)));
        contract.reject_proof(0);
    }

    #[test]
    #[should_panic(expected = "No proof submitted to reject")]
    fn reject_without_proof_fails() {
        let mut contract = setup();
        create_open_task(&mut contract);
        testing_env!(ctx(accounts(0), NearToken::from_yoctonear(0)));
        contract.reject_proof(0);
    }

    #[test]
    fn cancel_task_marks_cancelled() {
        let mut contract = setup();
        create_open_task(&mut contract);
        testing_env!(ctx(accounts(0), NearToken::from_yoctonear(0)));
        // In unit tests the mocked env records the refund Promise; the
        // actual refund is exercised in the sandbox integration test.
        let _ = contract.cancel_task(0);
        let task = contract.get_task(0).unwrap();
        assert_eq!(task.status, TaskStatus::Cancelled);
        assert_eq!(contract.get_task_count(), 1);
    }

    #[test]
    #[should_panic(expected = "Only an open (unclaimed) task can be cancelled")]
    fn cancel_claimed_task_fails() {
        let mut contract = setup();
        create_open_task(&mut contract);
        testing_env!(ctx(accounts(1), NearToken::from_yoctonear(0)));
        contract.claim_task(0);
        testing_env!(ctx(accounts(0), NearToken::from_yoctonear(0)));
        contract.cancel_task(0);
    }

    #[test]
    #[should_panic(expected = "Only the creator can cancel the task")]
    fn cancel_by_non_creator_fails() {
        let mut contract = setup();
        create_open_task(&mut contract);
        testing_env!(ctx(accounts(1), NearToken::from_yoctonear(0)));
        contract.cancel_task(0);
    }

    #[test]
    fn list_tasks_newest_first_with_pagination() {
        let mut contract = setup();
        for i in 0..3 {
            testing_env!(ctx(accounts(0), ONE_NEAR));
            contract.create_task(
                format!("task {}", i),
                "d".to_string(),
                "text".to_string(),
            );
        }
        assert_eq!(contract.get_task_count(), 3);
        let all = contract.list_tasks(None, None);
        assert_eq!(all.len(), 3);
        assert_eq!(all[0].id, 2);
        assert_eq!(all[1].id, 1);
        assert_eq!(all[2].id, 0);
        let page = contract.list_tasks(Some(1), Some(1));
        assert_eq!(page.len(), 1);
        assert_eq!(page[0].id, 1);
        let empty = contract.list_tasks(Some(3), Some(10));
        assert!(empty.is_empty());
    }

    #[test]
    fn get_task_returns_none_for_missing_task() {
        let contract = setup();
        assert_eq!(contract.get_task(0), None);
        assert_eq!(contract.get_task_count(), 0);
        assert!(contract.list_tasks(None, None).is_empty());
    }

    #[test]
    #[should_panic(expected = "at most 1 yoctoNEAR")]
    fn change_methods_reject_real_deposit() {
        let mut contract = setup();
        create_open_task(&mut contract);
        // Attaching 1 NEAR to claim_task must fail: only 0 or 1 yocto allowed.
        testing_env!(ctx(accounts(1), ONE_NEAR));
        contract.claim_task(0);
    }
}
