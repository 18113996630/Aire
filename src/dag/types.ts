/**
 * AIRE DAG Task Graph Core Types & Contracts
 * Reference: docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md
 */

export type TaskExecutionStatus =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'VERIFYING'
  | 'REPAIRING'
  | 'RETRYING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'BLOCKED'
  | 'CANCELLED';

export interface TaskGraphVerification {
  build?: boolean | { scheme?: string };
  visual?: {
    reference: string;
    focus?: string;
    tolerance?: {
      containerDeltaMax?: number;
      spacingPtMax?: number;
      textDeltaMax?: number;
    };
  };
  test?: {
    testPlan?: string;
  };
}

export interface TaskNode {
  id: string;
  title: string;
  goal: string;
  non_goals?: string[];
  role: string;
  dependencies: string[];
  dependents: string[];
  allowed_files: string[];
  acceptance_criteria: string[];
  verification: TaskGraphVerification;
  max_retries?: number;
}

export interface TaskGraphConfig {
  version: string;
  project: {
    name: string;
    targetScheme: string;
  };
  tasks: TaskNode[];
}

export interface TaskError {
  type: string;
  message: string;
  details?: unknown;
}

export interface TaskRunRecord {
  taskId: string;
  status: TaskExecutionStatus;
  retryCount: number;
  baseCommit?: string;
  commit?: string;
  startedAt?: string;
  completedAt?: string;
  blockedBy?: string;
  error?: TaskError;
  resultPath?: string;
}

export interface DagRunState {
  schemaVersion: string;
  graphVersion: string;
  graphHash: string;
  runId: string;
  graphPath: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'HALTED' | 'FAILED';
  activeTaskIds: string[];
  startedAt: string;
  updatedAt: string;
  tasks: Record<string, TaskRunRecord>;
}

export interface TaskResult {
  taskId: string;
  title: string;
  goal: string;
  status: 'SUCCEEDED';
  summary: string;
  changedFiles: string[];
  artifacts: string[];
  apiContracts?: string[];
  baseCommit: string;
  commit: string;
  completedAt: string;
}

export interface WorkspaceContext {
  projectPath: string;
  taskId: string;
  runId: string;
  allowedFiles: string[];
}

export interface CommitMetadata {
  runId: string;
  taskId: string;
  baseCommit: string;
  title: string;
}

export interface SchedulerOptions {
  projectPath: string;
  maxConcurrency?: number;
  retryTaskId?: string;
}

export const FailureDecision = {
  CASCADE_BLOCK_AND_CONTINUE: 'CASCADE_BLOCK_AND_CONTINUE',
  ABORT_ALL: 'ABORT_ALL',
} as const;

export type FailureDecision = (typeof FailureDecision)[keyof typeof FailureDecision];

export interface TaskExecutionOutcome {
  success: boolean;
  taskId: string;
  baseCommit?: string;
  commit?: string;
  changedFiles?: string[];
  artifacts?: string[];
  apiContracts?: string[];
  error?: TaskError;
  summary?: string;
}

export type TaskExecutionSummary = TaskExecutionOutcome;

export interface DagExecutionReport {
  runId: string;
  status: 'SUCCEEDED' | 'HALTED' | 'FAILED';
  durationMs: number;
  completedTasks: string[];
  failedTasks: string[];
  blockedTasks: string[];
  taskReports: Record<string, TaskExecutionOutcome>;
}
