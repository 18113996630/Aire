import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

describe('Plan Auto-Run Safety Boundary', () => {
  test('refuses auto-run when workspace contains user modifications', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aire-safety-test-'));

    try {
      // Initialize a clean git repo
      await execFileAsync('git', ['init', '-b', 'main'], { cwd: tmpDir });
      await execFileAsync('git', ['config', 'user.name', 'Test User'], { cwd: tmpDir });
      await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir });

      // Create an initial commit
      await fs.writeFile(path.join(tmpDir, 'Initial.txt'), 'Initial', 'utf-8');
      await execFileAsync('git', ['add', '-A'], { cwd: tmpDir });
      await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: tmpDir });

      // Create uncommitted user modification
      const userFile = path.join(tmpDir, 'UserChange.swift');
      await fs.writeFile(userFile, '// User uncommitted code', 'utf-8');

      // Create reference image and prd
      const refPath = path.join(tmpDir, 'reference.png');
      await fs.copyFile(path.resolve('fixtures/MiniApp/reference.png'), refPath);
      const prdPath = path.join(tmpDir, 'prd.md');
      await fs.writeFile(prdPath, '# App\n## Feature\nContent', 'utf-8');

      // Run aire plan with --auto-run
      const aireBin = path.resolve('bin/aire.ts');
      let failed = false;
      let stderr = '';

      try {
        await execFileAsync(
          process.execPath,
          ['--experimental-strip-types', aireBin, 'plan', '--project', tmpDir, '--reference', refPath, '--prd', prdPath, '--auto-run'],
          {
            cwd: tmpDir,
            env: {
              ...process.env,
              AIRE_MOCK_RUNNER: '1',
            },
          }
        );
      } catch (err: any) {
        failed = true;
        stderr = err.stderr || err.stdout || err.message;
      }

      assert.equal(failed, true, 'aire plan --auto-run must fail when user files are dirty');
      assert.ok(
        stderr.includes('Workspace Safety Violation') || stderr.includes('Refusing to run --auto-run'),
        `Expected safety violation message, got: ${stderr}`
      );

      // Verify UserChange.swift is still untracked and was NOT committed!
      const { stdout: statusAfter } = await execFileAsync('git', ['status', '--porcelain'], { cwd: tmpDir });
      assert.ok(statusAfter.includes('UserChange.swift'), 'UserChange.swift must remain uncommitted');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
