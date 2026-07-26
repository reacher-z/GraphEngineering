export const CHECKPOINT_API_VERSION =
  "graphengineering.reacher-z.github.io/checkpoints/v1alpha1" as const;

export interface CheckpointInput {
  runId: string;
  checkpointId: string;
  sequence: number;
  createdAt?: string;
  state: unknown;
}

export interface CheckpointBody {
  apiVersion: typeof CHECKPOINT_API_VERSION;
  runId: string;
  checkpointId: string;
  sequence: number;
  createdAt: string;
  state: unknown;
}

export interface StoredCheckpoint extends CheckpointBody {
  contentHash: string;
}

export interface CheckpointSummary {
  apiVersion: typeof CHECKPOINT_API_VERSION;
  runId: string;
  checkpointId: string;
  sequence: number;
  createdAt: string;
  contentHash: string;
}

export interface CheckpointStore {
  save(checkpoint: CheckpointInput): Promise<StoredCheckpoint>;
  load(runId: string, checkpointId: string): Promise<StoredCheckpoint | null>;
  list(runId: string): Promise<readonly CheckpointSummary[]>;
}
