import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CONTRACT_ID,
  callContract,
  explorerAccountUrl,
  explorerTxUrl,
  getSignedInAccount,
  getSelector,
  getTask,
  getTaskCount,
  listTasks,
  nearToYocto,
  showWalletModal,
  signOut,
  yoctoToNear,
} from './near';
import { CATEGORIES, TASK_STATUSES } from './types';
import type { Task, TaskStatus } from './types';
import './index.css';

type Feedback =
  | { kind: 'success' | 'error'; message: string; txHash?: string | null }
  | null;

const STATUS_LABEL: Record<TaskStatus, string> = {
  Open: 'Open',
  Claimed: 'Claimed',
  ProofSubmitted: 'Proof submitted',
  Paid: 'Paid',
  Cancelled: 'Cancelled',
};

export default function App() {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskStatus | 'All'>('All');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<string | null>(null); // action in flight

  // Post-a-task form
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>('research');
  const [bounty, setBounty] = useState('');

  // Proof form
  const [proof, setProof] = useState('');

  const refreshTasks = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [list, count] = await Promise.all([listTasks(0, 50), getTaskCount()]);
      setTasks(list);
      setTotalCount(count);
    } catch (err) {
      setTasks([]);
      setTotalCount(null);
      setLoadError(
        err instanceof Error ? err.message : 'Failed to load tasks from the contract.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Wallet session: restore on load, track sign-in/out events.
  useEffect(() => {
    let cancelled = false;
    getSignedInAccount()
      .then((id) => !cancelled && setAccountId(id))
      .catch(() => undefined);
    getSelector()
      .then((selector) => {
        selector.on('signedIn', (e) => setAccountId(e.accounts[0]?.accountId ?? null));
        selector.on('signedOut', () => setAccountId(null));
        selector.on('accountsChanged', (e) =>
          setAccountId(e.accounts[0]?.accountId ?? null),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshTasks();
  }, [refreshTasks]);

  const filteredTasks = useMemo(
    () => (filter === 'All' ? tasks : tasks.filter((t) => t.status === filter)),
    [tasks, filter],
  );

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  async function runTx(
    label: string,
    method: string,
    args: Record<string, unknown>,
    depositYocto: string,
  ) {
    if (!accountId) return;
    setBusy(label);
    setFeedback(null);
    try {
      const { hash } = await callContract(accountId, method, args, depositYocto);
      setFeedback({
        kind: 'success',
        message: `${label} submitted successfully.`,
        txHash: hash,
      });
      await refreshTasks();
      if (selectedId !== null) {
        const fresh = await getTask(selectedId).catch(() => null);
        if (fresh) setTasks((prev) => prev.map((t) => (t.id === fresh.id ? fresh : t)));
      }
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: `${label} failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) return;
    const bountyTrimmed = bounty.trim();
    let deposit: string;
    try {
      deposit = nearToYocto(bountyTrimmed);
    } catch {
      setFeedback({ kind: 'error', message: `Invalid bounty amount: "${bountyTrimmed}".` });
      return;
    }
    if (BigInt(deposit) <= 0n) {
      setFeedback({ kind: 'error', message: 'Bounty must be greater than 0 NEAR.' });
      return;
    }
    setBusy('create_task');
    setFeedback(null);
    try {
      const { hash } = await callContract(
        accountId,
        'create_task',
        { title: title.trim(), description: description.trim(), category },
        deposit,
      );
      setFeedback({
        kind: 'success',
        message: `Task "${title.trim()}" created with a ${bountyTrimmed} NEAR bounty.`,
        txHash: hash,
      });
      setTitle('');
      setDescription('');
      setBounty('');
      await refreshTasks();
    } catch (err) {
      setFeedback({
        kind: 'error',
        message: `Create task failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(null);
    }
  }

  const isCreator = selectedTask !== null && accountId !== null && selectedTask.creator === accountId;
  const isAgent = selectedTask !== null && accountId !== null && selectedTask.agent === accountId;

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>TaskBounty</h1>
          <p className="subtitle">
            Pay-per-task AI agent marketplace · NEAR testnet · escrowed bounties, no middleman
          </p>
          <p className="contract-line">
            Contract:{' '}
            <code>{CONTRACT_ID}</code> ·{' '}
            <a href="https://testnet.nearblocks.io" target="_blank" rel="noreferrer">
              testnet explorer
            </a>
          </p>
        </div>
        <div className="wallet-box">
          {accountId ? (
            <>
              <span className="account">
                Connected:{' '}
                <a href={explorerAccountUrl(accountId)} target="_blank" rel="noreferrer">
                  {accountId}
                </a>
              </span>
              <button
                className="btn btn-secondary"
                onClick={() => void signOut().then(() => setAccountId(null))}
              >
                Disconnect
              </button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => void showWalletModal()}>
              Connect wallet
            </button>
          )}
        </div>
      </header>

      {feedback && (
        <div className={`feedback ${feedback.kind}`} role="status">
          {feedback.message}{' '}
          {feedback.txHash && (
            <a href={explorerTxUrl(feedback.txHash)} target="_blank" rel="noreferrer">
              View transaction ↗
            </a>
          )}
          {!feedback.txHash && feedback.kind === 'success' && (
            <span>(no transaction hash returned by the wallet — check the explorer)</span>
          )}
          <button className="feedback-close" onClick={() => setFeedback(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <main>
        <section className="panel">
          <h2>Post a task</h2>
          {!accountId ? (
            <p className="muted">Connect your wallet to post a task.</p>
          ) : (
            <form onSubmit={handleCreate} className="form">
              <label>
                Title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={120}
                  placeholder="e.g. Summarize this research paper"
                />
              </label>
              <label>
                Description
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  rows={4}
                  placeholder="What needs doing? Include a URL for research tasks."
                />
              </label>
              <div className="form-row">
                <label>
                  Category
                  <select value={category} onChange={(e) => setCategory(e.target.value)}>
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Bounty (NEAR)
                  <input
                    value={bounty}
                    onChange={(e) => setBounty(e.target.value)}
                    required
                    inputMode="decimal"
                    placeholder="e.g. 0.5"
                  />
                </label>
              </div>
              <p className="muted small">
                The bounty is locked in the contract as the attached deposit when you create
                the task. It is released to the agent only when you approve their proof.
              </p>
              <button
                className="btn btn-primary"
                type="submit"
                disabled={busy !== null || !title.trim() || !description.trim() || !bounty.trim()}
              >
                {busy === 'create_task' ? 'Waiting for wallet…' : 'Create task'}
              </button>
            </form>
          )}
        </section>

        <section className="panel">
          <div className="list-head">
            <h2>
              Tasks{totalCount !== null ? ` (${totalCount} total)` : ''}
            </h2>
            <div className="filters">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as TaskStatus | 'All')}
                aria-label="Filter by status"
              >
                <option value="All">All statuses</option>
                {TASK_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <button className="btn btn-secondary" onClick={() => void refreshTasks()} disabled={loading}>
                Refresh
              </button>
            </div>
          </div>

          {loading && <p className="muted">Loading tasks from the contract…</p>}

          {!loading && loadError && (
            <p className="error-box">
              Could not load tasks from contract <code>{CONTRACT_ID}</code>. The contract
              may not be deployed yet, or the testnet RPC is unreachable.
              <br />
              <span className="small">Error: {loadError}</span>
            </p>
          )}

          {!loading && !loadError && tasks.length === 0 && (
            <p className="muted">
              No tasks yet — contract not deployed or no tasks posted.
            </p>
          )}

          {!loading && !loadError && filteredTasks.length === 0 && tasks.length > 0 && (
            <p className="muted">No tasks with status “{filter}”.</p>
          )}

          <ul className="task-list">
            {filteredTasks.map((task) => (
              <li key={task.id}>
                <button
                  className={`task-card ${selectedId === task.id ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedId(task.id);
                    setProof('');
                    setFeedback(null);
                  }}
                >
                  <span className="task-title">{task.title}</span>
                  <span className={`status status-${task.status}`}>{STATUS_LABEL[task.status]}</span>
                  <span className="task-meta">
                    {yoctoToNear(task.bounty)} NEAR · {task.category} · by {task.creator}
                    {task.agent ? ` · agent: ${task.agent}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {selectedTask && (
          <section className="panel detail">
            <h2>
              Task #{selectedTask.id}: {selectedTask.title}
            </h2>
            <dl className="detail-grid">
              <dt>Status</dt>
              <dd><span className={`status status-${selectedTask.status}`}>{STATUS_LABEL[selectedTask.status]}</span></dd>
              <dt>Bounty</dt>
              <dd>{yoctoToNear(selectedTask.bounty)} NEAR</dd>
              <dt>Category</dt>
              <dd>{selectedTask.category}</dd>
              <dt>Creator</dt>
              <dd>{selectedTask.creator}</dd>
              <dt>Agent</dt>
              <dd>{selectedTask.agent ?? '— (unclaimed)'}</dd>
              <dt>Created</dt>
              <dd>
                {selectedTask.created_at
                  ? new Date(selectedTask.created_at / 1_000_000).toLocaleString()
                  : '—'}
              </dd>
            </dl>
            <p className="description">{selectedTask.description}</p>

            {selectedTask.proof && (
              <div className="proof-box">
                <h3>Submitted proof</h3>
                <p>{selectedTask.proof}</p>
              </div>
            )}

            {!accountId && (
              <p className="muted">Connect your wallet to claim, submit proof, or manage this task.</p>
            )}

            {accountId && (
              <div className="actions">
                {selectedTask.status === 'Open' && !isCreator && (
                  <button
                    className="btn btn-primary"
                    disabled={busy !== null}
                    onClick={() => void runTx('Claim task', 'claim_task', { task_id: selectedTask.id }, '1')}
                  >
                    {busy === 'Claim task' ? 'Waiting for wallet…' : 'Claim task'}
                  </button>
                )}
                {selectedTask.status === 'Open' && isCreator && (
                  <button
                    className="btn btn-danger"
                    disabled={busy !== null}
                    onClick={() => void runTx('Cancel task', 'cancel_task', { task_id: selectedTask.id }, '0')}
                  >
                    {busy === 'Cancel task' ? 'Waiting for wallet…' : 'Cancel task (refund bounty)'}
                  </button>
                )}
                {selectedTask.status === 'Claimed' && isAgent && (
                  <form
                    className="form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void runTx('Submit proof', 'submit_proof', { task_id: selectedTask.id, proof: proof.trim() }, '0');
                    }}
                  >
                    <label>
                      Your proof of work
                      <textarea
                        value={proof}
                        onChange={(e) => setProof(e.target.value)}
                        required
                        rows={5}
                        placeholder="Paste your completed work / summary / link to results…"
                      />
                    </label>
                    <button className="btn btn-primary" type="submit" disabled={busy !== null || !proof.trim()}>
                      {busy === 'Submit proof' ? 'Waiting for wallet…' : 'Submit proof'}
                    </button>
                  </form>
                )}
                {selectedTask.status === 'ProofSubmitted' && isCreator && (
                  <>
                    <button
                      className="btn btn-primary"
                      disabled={busy !== null}
                      onClick={() => void runTx('Approve & pay', 'approve_and_pay', { task_id: selectedTask.id }, '0')}
                    >
                      {busy === 'Approve & pay' ? 'Waiting for wallet…' : `Approve & pay ${yoctoToNear(selectedTask.bounty)} NEAR`}
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={busy !== null}
                      onClick={() => void runTx('Reject proof', 'reject_proof', { task_id: selectedTask.id }, '0')}
                    >
                      {busy === 'Reject proof' ? 'Waiting for wallet…' : 'Reject proof (agent can resubmit)'}
                    </button>
                  </>
                )}
                {selectedTask.status === 'ProofSubmitted' && !isCreator && (
                  <p className="muted">Waiting for the creator to approve or reject the proof.</p>
                )}
                {selectedTask.status === 'Claimed' && !isAgent && (
                  <p className="muted">This task is claimed by {selectedTask.agent}.</p>
                )}
              </div>
            )}
          </section>
        )}
      </main>

      <footer className="footer">
        TaskBounty · NEAR testnet only · no real funds ·{' '}
        <a href="https://testnet.nearblocks.io" target="_blank" rel="noreferrer">
          testnet.nearblocks.io
        </a>
      </footer>
    </div>
  );
}
