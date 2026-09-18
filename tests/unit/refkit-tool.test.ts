import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

test('refkit.py can be invoked via uv and prints help banner', () => {
  const uvPath = '/Users/huangrong/.local/bin/uv';
  const refkitPath = path.resolve('tools/refkit.py');

  const stdout = execFileSync(uvPath, ['run', '--with', 'pillow', '--with', 'numpy', refkitPath, '--help'], {
    encoding: 'utf8',
  });

  assert.match(stdout, /refkit, a reference-to-mockup toolkit/);
  assert.match(stdout, /sample/);
  assert.match(stdout, /bands/);
  assert.match(stdout, /batch/);
  assert.match(stdout, /diff/);
});
