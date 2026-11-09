// Task shape — mirrors the contract state in ../DESIGN.md exactly.
export type TaskStatus =
  | 'Open'
  | 'Claimed'
  | 'ProofSubmitted'
  | 'Paid'
  | 'Cancelled';

export interface Task {
  id: number;
  creator: string;
  agent: string | null;
  title: string;
  description: string;
  category: string; // "research" | "text" | "other"
  bounty: string; // yoctoNEAR, as a decimal string
  status: TaskStatus;
  proof: string | null;
  created_at: number; // block timestamp (ns)
}

export const TASK_STATUSES: TaskStatus[] = [
  'Open',
  'Claimed',
  'ProofSubmitted',
  'Paid',
  'Cancelled',
];

export const CATEGORIES = ['research', 'text', 'other'] as const;
