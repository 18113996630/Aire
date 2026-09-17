import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { MockCliAdapter } from '../../src/runtime/mock.adapter.ts';
import { OpenCodeCliAdapter } from '../../src/runtime/opencode.adapter.ts';

describe('CliAdapters', () => {
  test('MockCliAdapter executes custom scripted responses per iteration', async () => {
    const adapter = new MockCliAdapter([
      async (params) => ({
        exitCode: 0,
        stdout: 'First modification',
        stderr: '',
        durationMs: 10
      }),
      async (params) => ({
        exitCode: 0,
        stdout: 'Fix applied',
        stderr: '',
        durationMs: 15
      })
    ]);

    assert.equal(adapter.name, 'MockCli');
    assert.equal(await adapter.isAvailable(), true);

    const res1 = await adapter.execute({ cwd: '/test', prompt: 'Initial task' });
    assert.equal(res1.stdout, 'First modification');

    const res2 = await adapter.execute({ cwd: '/test', prompt: 'Fix error' });
    assert.equal(res2.stdout, 'Fix applied');
  });

  test('MockCliAdapter falls back to default execution when scripted behaviors are exhausted', async () => {
    const adapter = new MockCliAdapter();
    assert.equal(adapter.name, 'MockCli');
    assert.equal(await adapter.isAvailable(), true);

    const res = await adapter.execute({ cwd: '/test', prompt: 'Any task' });
    assert.equal(res.exitCode, 0);
    assert.equal(res.stdout, 'Default mock execution');
    assert.equal(res.durationMs, 5);
  });

  test('OpenCodeCliAdapter initializes and detects unavailable binary for non-existent path', async () => {
    const adapter = new OpenCodeCliAdapter('/nonexistent/bin/opencode');
    assert.equal(adapter.name, 'OpenCode');
    const available = await adapter.isAvailable();
    assert.equal(available, false);
  });
});
