import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkspaceContext, CommitMetadata } from './types.ts';
import type { IWorkspaceStrategy } from './workspace-strategy.interface.ts';

const execFileAsync = promisify(execFile);

import { DirtyWorkspaceError } from '../vcs/git-manager.ts';
export { DirtyWorkspaceError };

export class DisallowedFilesError extends Error {
  readonly disallowedFiles: string[];

  constructor(disallowedFiles: string[]) {
    super(
      `Disallowed files modified outside task allowed_files scope: ${disallowedFiles.join(', ')}`
    );
    this.name = 'DisallowedFilesError';
    this.disallowedFiles = disallowedFiles;
  }
}

/**
 * Matches a file path against an allowed_files pattern (exact, glob, or directory prefix).
 */
export function matchesAllowedFile(filePath: string, pattern: string): boolean {
  const normFile = filePath.replace(/^\.?\//, '');
  const normPattern = pattern.replace(/^\.?\//, '');
  if (normFile === normPattern) return true;
  if (typeof path.matchesGlob === 'function') {
    try {
      if (path.matchesGlob(normFile, normPattern)) return true;
    } catch {
      // ignore pattern syntax errors
    }
  }
  if (normFile.startsWith(normPattern.endsWith('/') ? normPattern : normPattern + '/')) return true;
  return false;
}

export class SerialWorkspaceStrategy implements IWorkspaceStrategy {
  private async runGit(args: string[], cwd: string): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim();
  }

  /**
   * Prepare the workspace before task execution begins.
   * Serial strategy operates in-place and ensures .aire/ is ignored locally via .git/info/exclude.
   */
  async prepareWorkspace(ctx: WorkspaceContext): Promise<void> {
    try {
      const gitDir = path.join(ctx.projectPath, '.git');
      const excludePath = path.join(gitDir, 'info', 'exclude');
      let excludeContent = '';
      try {
        excludeContent = await fs.readFile(excludePath, 'utf-8');
      } catch {
        // file or info dir might not exist yet
      }
      if (!excludeContent.includes('.aire')) {
        await fs.mkdir(path.join(gitDir, 'info'), { recursive: true });
        const toAppend = excludeContent.endsWith('\n') || excludeContent.length === 0 ? '.aire/\n' : '\n.aire/\n';
        await fs.appendFile(excludePath, toAppend, 'utf-8');
      }
    } catch {
      // Non-git directory or file system permission issue
    }
  }

  /**
   * Get the current HEAD commit SHA without asserting workspace cleanliness.
   */
  async getCurrentHead(ctx: WorkspaceContext | string): Promise<string> {
    const projectPath = typeof ctx === 'string' ? ctx : ctx.projectPath;
    return this.runGit(['rev-parse', 'HEAD'], projectPath);
  }

  /**
   * Capture a snapshot commit hash of the current clean state (baseCommit).
   * Throws DirtyWorkspaceError if working directory or index has uncommitted changes.
   */
  async captureSnapshot(ctx: WorkspaceContext): Promise<string> {
    const status = await this.runGit(['status', '--porcelain'], ctx.projectPath);
    if (status.trim().length > 0) {
      throw new DirtyWorkspaceError(
        `Cannot capture base snapshot: workspace has uncommitted changes in task '${ctx.taskId}'. Clean working directory required before task execution.\n${status}`
      );
    }
    return this.getCurrentHead(ctx);
  }

  /**
   * Rollback working directory and index hard to baseCommit, cleaning untracked files.
   */
  async rollbackWorkspace(ctx: WorkspaceContext, baseCommit: string): Promise<void> {
    await this.runGit(['reset', '--hard', baseCommit], ctx.projectPath);
    await this.runGit(['clean', '-fd'], ctx.projectPath);
  }

  /**
   * Parse relative paths of pending modified, added, or untracked files.
   */
  private async getPendingChangedFiles(projectPath: string): Promise<string[]> {
    const status = await this.runGit(['status', '--porcelain', '-uall'], projectPath);
    if (!status.trim()) return [];
    return status
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const entry = line.slice(2).trim();
        if (entry.includes(' -> ')) {
          return entry.split(' -> ')[1].trim();
        }
        return entry;
      });
  }

  /**
   * Validate changed files against allowed_files, stage them, and commit with AIRE Git Trailers.
   * Throws DisallowedFilesError if unauthorized files are touched.
   */
  async commitTaskWorkspace(ctx: WorkspaceContext, meta: CommitMetadata): Promise<string> {
    const pendingFiles = await this.getPendingChangedFiles(ctx.projectPath);

    if (ctx.allowedFiles && ctx.allowedFiles.length > 0) {
      const disallowed = pendingFiles.filter(
        (file) => !ctx.allowedFiles.some((pattern) => matchesAllowedFile(file, pattern))
      );
      if (disallowed.length > 0) {
        throw new DisallowedFilesError(disallowed);
      }
    }

    if (pendingFiles.length > 0) {
      await this.runGit(['add', '--', ...pendingFiles], ctx.projectPath);
    }

    const message = `feat(${meta.taskId}): ${meta.title}\n\nAIRE-Run-Id: ${meta.runId}\nAIRE-Task-Id: ${meta.taskId}\nAIRE-Base-Commit: ${meta.baseCommit}\n`;

    await this.runGit(['commit', '--allow-empty', '-m', message], ctx.projectPath);
    return this.getCurrentHead(ctx);
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
   * If expectedBaseCommit is provided, also validates AIRE-Base-Commit trailer equality.
   */
  async verifyCommitBelongsToTask(
    projectPath: string,
    commitSha: string,
    taskId: string,
    runId: string,
    expectedBaseCommit?: string
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
      let match = taskTrailer.trim() === taskId && runTrailer.trim() === runId;
      if (match && expectedBaseCommit) {
        const baseTrailer = await this.runGit(
          ['log', '-1', '--format=%(trailers:key=AIRE-Base-Commit,valueonly)', commitSha],
          projectPath
        );
        if (baseTrailer.trim() !== expectedBaseCommit) {
          return false;
        }

        // Strictly verify that the commit's first parent (HEAD^) equals expectedBaseCommit
        const parentSha = (await this.runGit(['rev-parse', `${commitSha}^`], projectPath)).trim();
        const resolvedExpectedBase = (await this.runGit(['rev-parse', expectedBaseCommit], projectPath)).trim();
        match = parentSha === resolvedExpectedBase;
      }
      return match;
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

