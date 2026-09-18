/**
 * AIRE Serial Workspace Strategy Implementation
 * Reference: docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md Sections 2.2.2, 4.3, 4.4
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkspaceContext, CommitMetadata } from './types.ts';
import type { IWorkspaceStrategy } from './workspace-strategy.interface.ts';

const execFileAsync = promisify(execFile);

export class SerialWorkspaceStrategy implements IWorkspaceStrategy {
  private async runGit(args: string[], cwd: string): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim();
  }

  /**
   * Prepare the workspace before task execution begins.
   * Serial strategy operates in-place on the project workspace.
   */
  async prepareWorkspace(_ctx: WorkspaceContext): Promise<void> {
    // In-place serial strategy does not require special workspace branching.
  }

  /**
   * Capture a snapshot commit hash of the current clean state (baseCommit).
   */
  async captureSnapshot(ctx: WorkspaceContext): Promise<string> {
    return this.runGit(['rev-parse', 'HEAD'], ctx.projectPath);
  }

  /**
   * Rollback working directory and index hard to baseCommit, cleaning untracked files.
   */
  async rollbackWorkspace(ctx: WorkspaceContext, baseCommit: string): Promise<void> {
    await this.runGit(['reset', '--hard', baseCommit], ctx.projectPath);
    await this.runGit(['clean', '-fd'], ctx.projectPath);
  }

  /**
   * Stage task changes (git add -A) and commit with standardized AIRE Git Trailers.
   * Returns the new commit SHA (git rev-parse HEAD).
   */
  async commitTaskWorkspace(ctx: WorkspaceContext, meta: CommitMetadata): Promise<string> {
    await this.runGit(['add', '-A'], ctx.projectPath);

    const message = `feat(${meta.taskId}): ${meta.title}\n\nAIRE-Run-Id: ${meta.runId}\nAIRE-Task-Id: ${meta.taskId}\nAIRE-Base-Commit: ${meta.baseCommit}\n`;

    await this.runGit(['commit', '-m', message], ctx.projectPath);
    return this.captureSnapshot(ctx);
  }

  /**
   * Extract relative paths of files changed between baseCommit and HEAD.
   */
  async extractChangedFiles(ctx: WorkspaceContext, baseCommit: string): Promise<string[]> {
    const output = await this.runGit(['diff', '--name-only', `${baseCommit}..HEAD`], ctx.projectPath);
    if (!output) {
      return [];
    }
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  }

  /**
   * Verify using Git Trailers whether a commit strictly belongs to the given task and run.
   */
  async verifyCommitBelongsToTask(
    projectPath: string,
    commitSha: string,
    taskId: string,
    runId: string
  ): Promise<boolean> {
    if (!commitSha || !taskId || !runId) {
      return false;
    }

    try {
      const taskTrailer = await this.runGit(
        ['log', '-1', '--format=%(trailers:key=AIRE-Task-Id,valueonly)', commitSha],
        projectPath
      );
      const runTrailer = await this.runGit(
        ['log', '-1', '--format=%(trailers:key=AIRE-Run-Id,valueonly)', commitSha],
        projectPath
      );
      return taskTrailer.trim() === taskId && runTrailer.trim() === runId;
    } catch {
      return false;
    }
  }

  /**
   * Clean up workspace resources after task lifecycle completes.
   */
  async cleanupWorkspace(_ctx: WorkspaceContext): Promise<void> {
    // In-place serial strategy does not require cleanup of worktrees.
  }
}
