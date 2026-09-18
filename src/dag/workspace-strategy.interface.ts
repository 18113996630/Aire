/**
 * AIRE Workspace Strategy Interface
 * Reference: docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md Section 2.2.2
 */

import type { WorkspaceContext, CommitMetadata } from './types.ts';

export interface IWorkspaceStrategy {
  /**
   * Prepare the workspace before task execution begins
   */
  prepareWorkspace(ctx: WorkspaceContext): Promise<void>;

  /**
   * Capture a snapshot commit hash of the current clean state (baseCommit)
   */
  captureSnapshot(ctx: WorkspaceContext): Promise<string>;

  /**
   * Get the current HEAD commit SHA without asserting workspace cleanliness
   */
  getCurrentHead?(ctx: WorkspaceContext | string): Promise<string>;

  /**
   * Rollback working directory and index hard to baseCommit, cleaning untracked files
   */
  rollbackWorkspace(ctx: WorkspaceContext, baseCommit: string): Promise<void>;

  /**
   * Stage task changes and create a commit injected with standardized AIRE Git Trailers
   */
  commitTaskWorkspace(ctx: WorkspaceContext, meta: CommitMetadata): Promise<string>;

  /**
   * Extract relative paths of files changed between baseCommit and HEAD
   */
  extractChangedFiles(ctx: WorkspaceContext, baseCommit: string): Promise<string[]>;

  /**
   * Verify using Git Trailers whether a commit strictly belongs to the given task and run
   */
  verifyCommitBelongsToTask(
    projectPath: string,
    commitSha: string,
    taskId: string,
    runId: string,
    expectedBaseCommit?: string
  ): Promise<boolean>;

  /**
   * Clean up workspace resources after task lifecycle completes
   */
  cleanupWorkspace(ctx: WorkspaceContext): Promise<void>;
}
