/**
 * AIRE Layer 3 E2E Test: Upstream Plan to Downstream Run Pipeline
 *
 * Validates the complete product loop:
 * 1. aire plan --help displays all required options.
 * 2. aire plan --reference ... --prd ... generates .aire/analysis-ir.json, docs/*.md, and task-graph.yaml.
 * 3. aire plan --auto-run seamlessly triggers aire run and executes the generated graph to SUCCEEDED.
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TaskGraph } from '../../src/dag/task-graph.ts';

const execFileAsync = promisify(execFile);
const nodeBin = process.execPath || '/Users/huangrong/.nvm/versions/node/v25.3.0/bin/node';
const repoRoot = path.resolve(import.meta.dirname, '../..');
const cliPath = path.join(repoRoot, 'bin', 'aire.ts');
const fixtureRef = path.join(repoRoot, 'fixtures', 'MiniApp', 'reference.png');

describe('E2E: Upstream Multi-Agent Planner (aire plan)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aire-e2e-plan-'));
  });

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('bin/aire.ts plan --help displays all planning options', async () => {
    const { stdout } = await execFileAsync(
      nodeBin,
      ['--experimental-strip-types', cliPath, 'plan', '--help'],
      { encoding: 'utf8', cwd: repoRoot }
    );

    assert.match(stdout, /--reference <path>/);
    assert.match(stdout, /--prd <path>/);
    assert.match(stdout, /--output <path>/);
    assert.match(stdout, /--auto-run/);
    assert.match(stdout, /--app-name <name>/);
  });

  test('bin/aire.ts plan generates analysis-ir.json, human docs, and valid task-graph.yaml', async () => {
    const prdPath = path.join(tmpDir, 'prd.md');
    await fs.writeFile(
      prdPath,
      `# MiniApp Specifications\n## Feature 1: Greeting Display\nDisplay greeting card with customizable title and message.\n`,
      'utf-8'
    );

    const outYaml = path.join(tmpDir, 'task-graph.yaml');

    const { stdout } = await execFileAsync(
      nodeBin,
      [
        '--experimental-strip-types',
        cliPath,
        'plan',
        '--project', tmpDir,
        '--app-name', 'MiniApp',
        '--reference', fixtureRef,
        '--prd', prdPath,
        '--output', outYaml,
      ],
      { encoding: 'utf8', cwd: repoRoot }
    );

    assert.match(stdout, /Upstream Planning Succeeded/);
    assert.match(stdout, /Machine Truth/);
    assert.match(stdout, /Human Specs/);

    // Assert Machine Truth .aire/analysis-ir.json exists
    const irPath = path.join(tmpDir, '.aire', 'analysis-ir.json');
    const rawIr = await fs.readFile(irPath, 'utf-8');
    const parsedIr = JSON.parse(rawIr);
    assert.equal(parsedIr.appName, 'MiniApp');
    assert.ok(parsedIr.tokens.length > 0);

    // Assert Human Specs exist
    const productSpec = await fs.readFile(path.join(tmpDir, 'docs', 'product-spec.md'), 'utf-8');
    assert.ok(productSpec.includes('Product Specification: MiniApp'));

    const designSpec = await fs.readFile(path.join(tmpDir, 'docs', 'design-spec.md'), 'utf-8');
    assert.ok(designSpec.includes('Design Specification: MiniApp'));

    const archSpec = await fs.readFile(path.join(tmpDir, 'docs', 'architecture.md'), 'utf-8');
    assert.ok(archSpec.includes('Architecture Specification: MiniApp'));

    // Assert task-graph.yaml exists and is topologically valid
    const yamlContent = await fs.readFile(outYaml, 'utf-8');
    const taskGraph = TaskGraph.fromYaml(yamlContent);
    assert.equal(taskGraph.project?.name, 'MiniApp');
    assert.ok(taskGraph.getAllTasks().length >= 2);
  });

  test('bin/aire.ts plan --auto-run executes end-to-end through SerialDagScheduler', async () => {
    // Setup git repo in tmpDir for mock DAG execution
    await execFileAsync('git', ['init'], { cwd: tmpDir });
    await execFileAsync('git', ['config', 'user.name', 'AIRE Tester'], { cwd: tmpDir });
    await execFileAsync('git', ['config', 'user.email', 'aire@test.local'], { cwd: tmpDir });
    await execFileAsync('git', ['config', 'commit.gpgsign', 'false'], { cwd: tmpDir });

    const dummyFile = path.join(tmpDir, 'README.md');
    await fs.writeFile(dummyFile, '# MiniApp\n', 'utf-8');
    await execFileAsync('git', ['add', '-A'], { cwd: tmpDir });
    await execFileAsync('git', ['commit', '-m', 'chore: initial commit'], { cwd: tmpDir });

    const { stdout } = await execFileAsync(
      nodeBin,
      [
        '--experimental-strip-types',
        cliPath,
        'plan',
        '--project', tmpDir,
        '--app-name', 'MiniApp',
        '--reference', fixtureRef,
        '--auto-run',
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

    assert.match(stdout, /Upstream Planning Succeeded/);
    assert.match(stdout, /--auto-run enabled/);
    assert.match(stdout, /Auto-run completed successfully/);

    // Verify Git commit log contains AIRE trailers for generated tasks
    const { stdout: gitLog } = await execFileAsync(
      'git',
      ['log', '-n', '5', '--pretty=%B---'],
      { cwd: tmpDir }
    );
    assert.match(gitLog, /AIRE-Task-Id: task-/);
    assert.match(gitLog, /AIRE-Run-Id:/);
  });
});
