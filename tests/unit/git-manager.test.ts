import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { GitManager } from '../../src/vcs/git-manager.ts';

describe('GitManager', () => {
  let testRepoDir: string;

  beforeEach(() => {
    testRepoDir = mkdtempSync(join(tmpdir(), 'aire-git-test-'));
    execSync('git init -b main', { cwd: testRepoDir });
    execSync('git config user.name "Test"', { cwd: testRepoDir });
    execSync('git config user.email "test@test.com"', { cwd: testRepoDir });
    writeFileSync(join(testRepoDir, 'README.md'), '# Initial');
    execSync('git add . && git commit -m "initial commit"', { cwd: testRepoDir });
  });

  afterEach(() => {
    rmSync(testRepoDir, { recursive: true, force: true });
  });

  test('detects clean working directory and returns head commit sha', async () => {
    const git = new GitManager(testRepoDir);
    assert.equal(await git.isClean(), true);
    const sha = await git.getHeadSha();
    assert.match(sha, /^[a-f0-9]{40}$/);
  });

  test('commits changes cleanly with custom message', async () => {
    const git = new GitManager(testRepoDir);
    writeFileSync(join(testRepoDir, 'Feature.swift'), '// code');
    assert.equal(await git.isClean(), false);

    const newSha = await git.commitChanges('feat: add feature');
    assert.match(newSha, /^[a-f0-9]{40}$/);
    assert.equal(await git.isClean(), true);
  });

  test('resets hard to a previous commit sha on rollback', async () => {
    const git = new GitManager(testRepoDir);
    const initialSha = await git.getHeadSha();

    writeFileSync(join(testRepoDir, 'BadCode.swift'), '// corrupted');
    await git.commitChanges('feat: bad code');

    await git.hardReset(initialSha);
    assert.equal(await git.getHeadSha(), initialSha);
  });

  test('assertClean throws DirtyWorkspaceError when working directory is dirty', async () => {
    const git = new GitManager(testRepoDir);
    writeFileSync(join(testRepoDir, 'Dirty.swift'), '// dirty');
    await assert.rejects(async () => {
      await git.assertClean();
    }, /Working directory is dirty/);
  });

  test('commits message containing quotes, newlines, and shell characters safely without injection', async () => {
    const git = new GitManager(testRepoDir);
    writeFileSync(join(testRepoDir, 'Safe.swift'), '// safe');
    const complexMsg = 'feat: "hello" `touch /tmp/injected` $(echo evil) \n multi-line';
    const sha = await git.commitChanges(complexMsg);
    assert.match(sha, /^[a-f0-9]{40}$/);

    const logMsg = execSync('git log -1 --pretty=%B', { cwd: testRepoDir }).toString();
    assert.ok(logMsg.includes('`touch /tmp/injected`'));
    assert.ok(logMsg.includes('$(echo evil)'));
  });
});
