/**
 * AIRE Layer 3 E2E Test: DAG CLI Execution
 * Reference: docs/superpowers/specs/2026-09-18-aire-subproject3-task-graph-dag-engine-design.md Section 6.3
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const nodeBin = process.execPath || '/Users/huangrong/.nvm/versions/node/v25.3.0/bin/node';
const repoRoot = path.resolve(import.meta.dirname, '../..');
const cliPath = path.join(repoRoot, 'bin', 'aire.ts');
const fixtureDir = path.join(repoRoot, 'fixtures', 'MiniApp');

describe('CLI: aire run options and validation', () => {
  test('bin/aire.ts run --help displays dag options and does not expose --max-concurrency', async () => {
    const { stdout } = await execFileAsync(
      nodeBin,
      ['--experimental-strip-types', cliPath, 'run', '--help'],
      { encoding: 'utf8', cwd: repoRoot }
    );

    assert.match(stdout, /--task-graph <path>/);
    assert.match(stdout, /--resume/);
    assert.match(stdout, /--retry-task <id>/);
    assert.doesNotMatch(stdout, /--max-concurrency/);
  });

  test('bin/aire.ts run fails with error when neither task nor task-graph given', async () => {
    try {
      await execFileAsync(
        nodeBin,
        ['--experimental-strip-types', cliPath, 'run'],
        { encoding: 'utf8', cwd: repoRoot }
      );
      assert.fail('Expected process to exit with non-zero code');
    } catch (err: any) {
      assert.strictEqual(err.code, 1);
      const output = (err.stdout ?? '') + (err.stderr ?? '');
      assert.match(output, /Either --task or --task-graph \(or --resume\) must be specified/);
    }
  });

  test('bin/aire.ts run fails with error when --task is given without --project', async () => {
    try {
      await execFileAsync(
        nodeBin,
        ['--experimental-strip-types', cliPath, 'run', '--task', 'Build something'],
        { encoding: 'utf8', cwd: repoRoot }
      );
      assert.fail('Expected process to exit with non-zero code');
    } catch (err: any) {
      assert.strictEqual(err.code, 1);
      const output = (err.stdout ?? '') + (err.stderr ?? '');
      assert.match(output, /Option -p, --project is required/);
    }
  });

  test('bin/aire.ts run fails with error when --retry-task is given without --resume', async () => {
    try {
      await execFileAsync(
        nodeBin,
        ['--experimental-strip-types', cliPath, 'run', '--task-graph', 'task-graph.yaml', '--retry-task', 'task-a'],
        { encoding: 'utf8', cwd: repoRoot }
      );
      assert.fail('Expected process to exit with non-zero code');
    } catch (err: any) {
      assert.strictEqual(err.code, 1);
      const output = (err.stdout ?? '') + (err.stderr ?? '');
      assert.match(output, /--retry-task requires --resume/);
    }
  });
});

describe('CLI: E2E DAG Execution with MiniApp fixture', () => {
  let tempDir: string;

  async function runGit(args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd: tempDir });
    return stdout.trim();
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aire-e2e-dag-cli-'));

    // Copy MiniApp fixture into tempDir
    await fs.cp(fixtureDir, tempDir, { recursive: true });

    // Initialize clean git repository
    await runGit(['init', '-b', 'main']);
    await runGit(['config', 'user.name', 'Aire Tester']);
    await runGit(['config', 'user.email', 'tester@aire.local']);
    await runGit(['add', '-A']);
    await runGit(['commit', '-m', 'chore: initial commit']);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test('executes MiniApp task-graph with --task-graph and --project successfully', async () => {
    const taskGraphPath = path.join(tempDir, 'task-graph.yaml');

    const { stdout } = await execFileAsync(
      nodeBin,
      [
        '--experimental-strip-types',
        cliPath,
        'run',
        '--task-graph',
        taskGraphPath,
        '--project',
        tempDir,
      ],
      {
        encoding: 'utf8',
        cwd: repoRoot,
        env: {
          ...process.env,
          AIRE_MOCK_RUNNER: '1',
        },
      }
    );

    assert.match(stdout, /\[AIRE\] DAG execution SUCCEEDED!/);
    assert.match(stdout, /Completed tasks \(2\): task-data-model, task-card-view/);

    // Verify .aire/run-state.json
    const runStateRaw = await fs.readFile(path.join(tempDir, '.aire', 'run-state.json'), 'utf-8');
    const runState = JSON.parse(runStateRaw);
    assert.strictEqual(runState.status, 'SUCCEEDED');
    assert.strictEqual(runState.tasks['task-data-model'].status, 'SUCCEEDED');
    assert.strictEqual(runState.tasks['task-card-view'].status, 'SUCCEEDED');

    // Verify task artifacts
    const task1ResultRaw = await fs.readFile(
      path.join(tempDir, '.aire', 'tasks', 'task-data-model', 'result.json'),
      'utf-8'
    );
    const task1Result = JSON.parse(task1ResultRaw);
    assert.strictEqual(task1Result.taskId, 'task-data-model');

    const task2ResultRaw = await fs.readFile(
      path.join(tempDir, '.aire', 'tasks', 'task-card-view', 'result.json'),
      'utf-8'
    );
    const task2Result = JSON.parse(task2ResultRaw);
    assert.strictEqual(task2Result.taskId, 'task-card-view');

    // Verify git trailers in commits
    const logOutput = await runGit(['log', '--format=%B']);
    assert.match(logOutput, /AIRE-Task-Id: task-data-model/);
    assert.match(logOutput, /AIRE-Task-Id: task-card-view/);
  });

  test('executes MiniApp task-graph defaulting project to task-graph directory when --project is omitted', async () => {
    const taskGraphPath = path.join(tempDir, 'task-graph.yaml');

    const { stdout } = await execFileAsync(
      nodeBin,
      [
        '--experimental-strip-types',
        cliPath,
        'run',
        '--task-graph',
        taskGraphPath,
      ],
      {
        encoding: 'utf8',
        cwd: repoRoot,
        env: {
          ...process.env,
          AIRE_MOCK_RUNNER: '1',
        },
      }
    );

    assert.match(stdout, /📁 Project: /);
    assert.match(stdout, /\[AIRE\] DAG execution SUCCEEDED!/);
    assert.match(stdout, /Completed tasks \(2\): task-data-model, task-card-view/);

    const runStateRaw = await fs.readFile(path.join(tempDir, '.aire', 'run-state.json'), 'utf-8');
    const runState = JSON.parse(runStateRaw);
    assert.strictEqual(runState.status, 'SUCCEEDED');
  });

  test('resumes interrupted DAG execution with --resume', async () => {
    const taskGraphPath = path.join(tempDir, 'task-graph.yaml');

    // 1. First run to completion
    await execFileAsync(
      nodeBin,
      [
        '--experimental-strip-types',
        cliPath,
        'run',
        '--task-graph',
        taskGraphPath,
        '--project',
        tempDir,
      ],
      {
        encoding: 'utf8',
        cwd: repoRoot,
        env: {
          ...process.env,
          AIRE_MOCK_RUNNER: '1',
        },
      }
    );

    // 2. Resume run - should verify existing state and succeed
    const { stdout } = await execFileAsync(
      nodeBin,
      [
        '--experimental-strip-types',
        cliPath,
        'run',
        '--resume',
        '--task-graph',
        taskGraphPath,
        '--project',
        tempDir,
      ],
      {
        encoding: 'utf8',
        cwd: repoRoot,
        env: {
          ...process.env,
          AIRE_MOCK_RUNNER: '1',
        },
      }
    );

    assert.match(stdout, /\[AIRE\] Resuming DAG execution\.\.\./);
    assert.match(stdout, /\[AIRE\] DAG execution SUCCEEDED!/);
  });

  test('resumes and retries failed task with --retry-task and --resume', async () => {
    const taskGraphPath = path.join(tempDir, 'task-graph.yaml');

    // Run to completion initially
    await execFileAsync(
      nodeBin,
      [
        '--experimental-strip-types',
        cliPath,
        'run',
        '--task-graph',
        taskGraphPath,
        '--project',
        tempDir,
      ],
      {
        encoding: 'utf8',
        cwd: repoRoot,
        env: {
          ...process.env,
          AIRE_MOCK_RUNNER: '1',
        },
      }
    );

    // Simulate task-card-view having failed in run-state.json
    const statePath = path.join(tempDir, '.aire', 'run-state.json');
    const runState = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    runState.status = 'HALTED';
    runState.tasks['task-card-view'] = {
      taskId: 'task-card-view',
      status: 'FAILED',
      retryCount: 3,
      error: {
        type: 'BUILD',
        message: 'Simulated failure',
      },
    };
    await fs.writeFile(statePath, JSON.stringify(runState, null, 2), 'utf-8');

    // Execute with --resume and --retry-task
    const { stdout } = await execFileAsync(
      nodeBin,
      [
        '--experimental-strip-types',
        cliPath,
        'run',
        '--resume',
        '--task-graph',
        taskGraphPath,
        '--project',
        tempDir,
        '--retry-task',
        'task-card-view',
      ],
      {
        encoding: 'utf8',
        cwd: repoRoot,
        env: {
          ...process.env,
          AIRE_MOCK_RUNNER: '1',
        },
      }
    );

    assert.match(stdout, /🔁 Retry Task: task-card-view/);
    assert.match(stdout, /\[AIRE\] DAG execution SUCCEEDED!/);
    assert.match(stdout, /Completed tasks \(2\): task-data-model, task-card-view/);

    const updatedState = JSON.parse(await fs.readFile(statePath, 'utf-8'));
    assert.strictEqual(updatedState.status, 'SUCCEEDED');
    assert.strictEqual(updatedState.tasks['task-card-view'].status, 'SUCCEEDED');
  });
});

