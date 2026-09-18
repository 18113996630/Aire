import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import {
  SerialWorkspaceStrategy,
  DirtyWorkspaceError,
  DisallowedFilesError,
  matchesAllowedFile
} from '../../../src/dag/serial-workspace-strategy.ts';
import type { WorkspaceContext, CommitMetadata } from '../../../src/dag/types.ts';

describe('SerialWorkspaceStrategy', () => {
  let testRepoDir: string;
  let strategy: SerialWorkspaceStrategy;

  beforeEach(() => {
    testRepoDir = mkdtempSync(join(tmpdir(), 'aire-ws-test-'));
    execSync('git init -b main', { cwd: testRepoDir });
    execSync('git config user.name "Aire Test"', { cwd: testRepoDir });
    execSync('git config user.email "aire@test.com"', { cwd: testRepoDir });
    writeFileSync(join(testRepoDir, 'README.md'), '# Initial Repository\n');
    execSync('git add . && git commit -m "initial commit"', { cwd: testRepoDir });

    strategy = new SerialWorkspaceStrategy();
  });

  afterEach(() => {
    rmSync(testRepoDir, { recursive: true, force: true });
  });

  test('prepareWorkspace and cleanupWorkspace complete without error', async () => {
    const ctx: WorkspaceContext = {
      projectPath: testRepoDir,
      taskId: 'task-0',
      runId: 'run-001',
      allowedFiles: ['README.md']
    };

    await assert.doesNotReject(async () => {
      await strategy.prepareWorkspace(ctx);
      await strategy.cleanupWorkspace(ctx);
    });
  });

  test('captureSnapshot captures clean HEAD commit sha', async () => {
    const ctx: WorkspaceContext = {
      projectPath: testRepoDir,
      taskId: 'task-1',
      runId: 'run-001',
      allowedFiles: ['README.md']
    };

    const initialSha = execSync('git rev-parse HEAD', { cwd: testRepoDir }).toString().trim();
    const snapshotSha = await strategy.captureSnapshot(ctx);

    assert.equal(snapshotSha, initialSha);
    assert.match(snapshotSha, /^[a-f0-9]{40}$/);
  });

  test('commitTaskWorkspace stages changes and injects standard AIRE Git Trailers', async () => {
    const ctx: WorkspaceContext = {
      projectPath: testRepoDir,
      taskId: 'task-auth',
      runId: 'run-777',
      allowedFiles: ['Auth.swift', 'README.md']
    };

    const baseCommit = await strategy.captureSnapshot(ctx);

    // Modify file and add a new file
    writeFileSync(join(testRepoDir, 'Auth.swift'), '// Authentication Logic\n');
    writeFileSync(join(testRepoDir, 'README.md'), '# Updated Readme\n');

    const meta: CommitMetadata = {
      runId: 'run-777',
      taskId: 'task-auth',
      baseCommit,
      title: 'Implement user authentication'
    };

    const commitSha = await strategy.commitTaskWorkspace(ctx, meta);

    assert.match(commitSha, /^[a-f0-9]{40}$/);
    assert.notEqual(commitSha, baseCommit);

    // Verify git log output contains the expected subject and trailers
    const logRaw = execSync(`git log -1 --format="%B" ${commitSha}`, { cwd: testRepoDir }).toString();
    assert.match(logRaw, /^feat\(task-auth\): Implement user authentication/);

    const taskTrailer = execSync(
      `git log -1 --format="%(trailers:key=AIRE-Task-Id,valueonly)" ${commitSha}`,
      { cwd: testRepoDir }
    ).toString().trim();
    const runTrailer = execSync(
      `git log -1 --format="%(trailers:key=AIRE-Run-Id,valueonly)" ${commitSha}`,
      { cwd: testRepoDir }
    ).toString().trim();
    const baseCommitTrailer = execSync(
      `git log -1 --format="%(trailers:key=AIRE-Base-Commit,valueonly)" ${commitSha}`,
      { cwd: testRepoDir }
    ).toString().trim();

    assert.equal(taskTrailer, 'task-auth');
    assert.equal(runTrailer, 'run-777');
    assert.equal(baseCommitTrailer, baseCommit);
  });

  test('extractChangedFiles returns relative file paths between baseCommit and HEAD', async () => {
    const ctx: WorkspaceContext = {
      projectPath: testRepoDir,
      taskId: 'task-2',
      runId: 'run-001',
      allowedFiles: []
    };

    const baseCommit = await strategy.captureSnapshot(ctx);

    // Before any changes, changed files should be empty
    const noChanges = await strategy.extractChangedFiles(ctx, baseCommit);
    assert.deepEqual(noChanges, []);

    // Add and commit files
    writeFileSync(join(testRepoDir, 'fileA.swift'), '// A\n');
    writeFileSync(join(testRepoDir, 'fileB.swift'), '// B\n');

    const meta: CommitMetadata = {
      runId: 'run-001',
      taskId: 'task-2',
      baseCommit,
      title: 'Add A and B'
    };
    await strategy.commitTaskWorkspace(ctx, meta);

    const changedFiles = await strategy.extractChangedFiles(ctx, baseCommit);
    assert.deepEqual(changedFiles.sort(), ['fileA.swift', 'fileB.swift']);
  });

  test('verifyCommitBelongsToTask validates trailers accurately and handles edge cases', async () => {
    const ctx: WorkspaceContext = {
      projectPath: testRepoDir,
      taskId: 'task-payment',
      runId: 'run-999',
      allowedFiles: []
    };

    const baseCommit = await strategy.captureSnapshot(ctx);
    writeFileSync(join(testRepoDir, 'Payment.swift'), '// Payment\n');

    const meta: CommitMetadata = {
      runId: 'run-999',
      taskId: 'task-payment',
      baseCommit,
      title: 'Setup Apple Pay'
    };
    const commitSha = await strategy.commitTaskWorkspace(ctx, meta);

    // Positive check: matching taskId and runId
    const isMatch = await strategy.verifyCommitBelongsToTask(testRepoDir, commitSha, 'task-payment', 'run-999');
    assert.equal(isMatch, true);

    // Negative check: wrong taskId
    const wrongTask = await strategy.verifyCommitBelongsToTask(testRepoDir, commitSha, 'other-task', 'run-999');
    assert.equal(wrongTask, false);

    // Negative check: wrong runId
    const wrongRun = await strategy.verifyCommitBelongsToTask(testRepoDir, commitSha, 'task-payment', 'other-run');
    assert.equal(wrongRun, false);

    // Negative check: initial commit without trailers
    const initialCommit = baseCommit;
    const initialMatch = await strategy.verifyCommitBelongsToTask(testRepoDir, initialCommit, 'task-payment', 'run-999');
    assert.equal(initialMatch, false);

    // Negative check: invalid commit sha or corrupted path
    const invalidSha = await strategy.verifyCommitBelongsToTask(testRepoDir, '0000000000000000000000000000000000000000', 'task-payment', 'run-999');
    assert.equal(invalidSha, false);

    const badPath = await strategy.verifyCommitBelongsToTask('/non/existent/dir', commitSha, 'task-payment', 'run-999');
    assert.equal(badPath, false);
  });

  test('rollbackWorkspace reverts tracked modifications and removes untracked files', async () => {
    const ctx: WorkspaceContext = {
      projectPath: testRepoDir,
      taskId: 'task-rollback',
      runId: 'run-001',
      allowedFiles: []
    };

    const baseCommit = await strategy.captureSnapshot(ctx);

    // Modify tracked README.md
    writeFileSync(join(testRepoDir, 'README.md'), '# Corrupted Readme\n');
    // Create new untracked file
    writeFileSync(join(testRepoDir, 'untracked.tmp'), 'untracked dirty file\n');

    assert.equal(readFileSync(join(testRepoDir, 'README.md'), 'utf-8'), '# Corrupted Readme\n');
    assert.equal(existsSync(join(testRepoDir, 'untracked.tmp')), true);

    // Perform rollback
    await strategy.rollbackWorkspace(ctx, baseCommit);

    // Verify state
    const currentSha = await strategy.captureSnapshot(ctx);
    assert.equal(currentSha, baseCommit);

    const restoredContent = readFileSync(join(testRepoDir, 'README.md'), 'utf-8');
    assert.equal(restoredContent, '# Initial Repository\n');

    assert.equal(existsSync(join(testRepoDir, 'untracked.tmp')), false);

    const status = execSync('git status --porcelain', { cwd: testRepoDir }).toString().trim();
    assert.equal(status, '');
  });

  test('captureSnapshot throws DirtyWorkspaceError when working directory is dirty', async () => {
    const ctx: WorkspaceContext = {
      projectPath: testRepoDir,
      taskId: 'task-dirty',
      runId: 'run-001',
      allowedFiles: []
    };

    // Make working directory dirty with uncommitted untracked file
    writeFileSync(join(testRepoDir, 'dirty.tmp'), 'dirty file\n');

    await assert.rejects(
      async () => {
        await strategy.captureSnapshot(ctx);
      },
      (err: any) => {
        assert.ok(err instanceof DirtyWorkspaceError);
        assert.match(err.message, /workspace has uncommitted changes/);
        return true;
      }
    );
  });

  test('commitTaskWorkspace throws DisallowedFilesError when disallowed files are modified', async () => {
    const ctx: WorkspaceContext = {
      projectPath: testRepoDir,
      taskId: 'task-disallowed',
      runId: 'run-002',
      allowedFiles: ['Sources/Allowed.swift']
    };

    const baseCommit = await strategy.getCurrentHead(ctx);

    // Write file outside allowedFiles
    writeFileSync(join(testRepoDir, 'Forbidden.swift'), '// unauthorized\n');

    const meta: CommitMetadata = {
      runId: 'run-002',
      taskId: 'task-disallowed',
      baseCommit,
      title: 'Modify forbidden file'
    };

    await assert.rejects(
      async () => {
        await strategy.commitTaskWorkspace(ctx, meta);
      },
      (err: any) => {
        assert.ok(err instanceof DisallowedFilesError);
        assert.deepEqual(err.disallowedFiles, ['Forbidden.swift']);
        return true;
      }
    );
  });

  test('commitTaskWorkspace accepts glob patterns in allowedFiles', async () => {
    const ctx: WorkspaceContext = {
      projectPath: testRepoDir,
      taskId: 'task-glob',
      runId: 'run-003',
      allowedFiles: ['Sources/**/*.swift', 'Config/*.json']
    };

    const baseCommit = await strategy.getCurrentHead(ctx);

    execSync('mkdir -p Sources/Feature Config', { cwd: testRepoDir });
    writeFileSync(join(testRepoDir, 'Sources/Feature/View.swift'), '// View\n');
    writeFileSync(join(testRepoDir, 'Config/settings.json'), '{}\n');

    const meta: CommitMetadata = {
      runId: 'run-003',
      taskId: 'task-glob',
      baseCommit,
      title: 'Add files matching globs'
    };

    const commitSha = await strategy.commitTaskWorkspace(ctx, meta);
    assert.match(commitSha, /^[a-f0-9]{40}$/);

    const changed = await strategy.extractChangedFiles(ctx, baseCommit);
    assert.deepEqual(changed.sort(), ['Config/settings.json', 'Sources/Feature/View.swift']);
  });

  test('verifyCommitBelongsToTask validates expectedBaseCommit trailer matching and mismatch', async () => {
    const ctx: WorkspaceContext = {
      projectPath: testRepoDir,
      taskId: 'task-trailer',
      runId: 'run-004',
      allowedFiles: ['README.md']
    };

    const baseCommit = await strategy.getCurrentHead(ctx);
    writeFileSync(join(testRepoDir, 'README.md'), '# Trailer test\n');

    const meta: CommitMetadata = {
      runId: 'run-004',
      taskId: 'task-trailer',
      baseCommit,
      title: 'Trailer test'
    };

    const commitSha = await strategy.commitTaskWorkspace(ctx, meta);

    // Matching expectedBaseCommit returns true
    const match = await strategy.verifyCommitBelongsToTask(
      testRepoDir,
      commitSha,
      'task-trailer',
      'run-004',
      baseCommit
    );
    assert.equal(match, true);

    // Mismatched expectedBaseCommit returns false
    const mismatch = await strategy.verifyCommitBelongsToTask(
      testRepoDir,
      commitSha,
      'task-trailer',
      'run-004',
      'wrong-base-commit-sha'
    );
    assert.equal(mismatch, false);
  });

  test('prepareWorkspace ensures .aire/ is appended to .git/info/exclude', async () => {
    const ctx: WorkspaceContext = {
      projectPath: testRepoDir,
      taskId: 'task-exclude',
      runId: 'run-005',
      allowedFiles: []
    };

    await strategy.prepareWorkspace(ctx);

    const excludeContent = readFileSync(join(testRepoDir, '.git', 'info', 'exclude'), 'utf-8');
    assert.match(excludeContent, /\.aire\//);

    // Calling again is idempotent and does not duplicate
    await strategy.prepareWorkspace(ctx);
    const count = (excludeContent.match(/\.aire\//g) || []).length;
    assert.equal(count, 1);
  });
});

