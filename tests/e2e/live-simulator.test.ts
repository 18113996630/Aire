import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('bin/aire.ts --help displays visual review options', () => {
  const nodeBin = process.execPath || '/Users/huangrong/.nvm/versions/node/v25.3.0/bin/node';
  const stdout = execFileSync(
    nodeBin,
    ['--experimental-strip-types', 'bin/aire.ts', 'run', '--help'],
    { encoding: 'utf8' }
  );

  assert.match(stdout, /--reference/);
  assert.match(stdout, /--focus/);
  assert.match(stdout, /--container-delta-max/);
  assert.match(stdout, /--spacing-pt-max/);
  assert.match(stdout, /--text-delta-max/);
  assert.match(stdout, /--device/);
});
