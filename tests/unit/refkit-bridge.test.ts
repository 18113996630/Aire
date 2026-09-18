import test from 'node:test';
import assert from 'node:assert/strict';
import { RefkitBridge } from '../../src/evaluator/visual/refkit-bridge.ts';

test('RefkitBridge parses batch output and flags probes exceeding tolerance', async () => {
  const mockUvRunner = async (args: string[]) => {
    if (args.includes('batch')) {
      return `
probe                 ref        mine       delta
bg                    #F2F2F7    #FFFFFF    13.0     <-- off
title-ink             #1D1D1F    #1D1D1F     0.0
card-inset            16.0       24.0        8.0     <-- off
mean Δ 9.50   worst 24px bands:
`;
    }
    return '';
  };

  const bridge = new RefkitBridge('/path/to/uv', '/path/to/refkit.py', mockUvRunner);
  const report = await bridge.runBatch('/tmp/probes.json', '/tmp/renders', 3.0);

  assert.equal(report.meanDelta, 9.5);
  assert.equal(report.passed, false);
  assert.equal(report.probeResults.length, 3);
  const offProbes = report.probeResults.filter((p) => !p.passed);
  assert.equal(offProbes.length, 2);
  assert.equal(offProbes[0].probeId, 'bg');
  assert.equal(offProbes[0].delta, 13.0);
});

test('RefkitBridge parses passing batch output correctly', async () => {
  const mockUvRunner = async (args: string[]) => {
    if (args.includes('batch')) {
      return `
probe                 ref        mine       delta
bg                    #FFFFFF    #FFFFFF     0.0
title-ink             #1D1D1F    #1D1D1F     0.0
mean Δ 2.10   worst 24px bands:
`;
    }
    return '';
  };

  const bridge = new RefkitBridge('/path/to/uv', '/path/to/refkit.py', mockUvRunner);
  const report = await bridge.runBatch('/tmp/probes.json', '/tmp/renders', 3.0);

  assert.equal(report.meanDelta, 2.1);
  assert.equal(report.passed, true);
  assert.equal(report.probeResults.length, 2);
  assert.ok(report.probeResults.every((p) => p.passed));
});

test('RefkitBridge parses diff output correctly', async () => {
  const mockUvRunner = async (args: string[]) => {
    if (args.includes('diff')) {
      return `mean Δ 4.25   worst 24px bands (mine vs ref):`;
    }
    return '';
  };

  const bridge = new RefkitBridge('/path/to/uv', '/path/to/refkit.py', mockUvRunner);
  const diffResult = await bridge.runDiff('/tmp/mine.png', '/tmp/ref.png');

  assert.equal(diffResult.meanDelta, 4.25);
});

test('RefkitBridge returns 0 meanDelta when diff output has no match', async () => {
  const mockUvRunner = async () => 'no delta output';
  const bridge = new RefkitBridge('/path/to/uv', '/path/to/refkit.py', mockUvRunner);
  const diffResult = await bridge.runDiff('/tmp/mine.png', '/tmp/ref.png');
  assert.equal(diffResult.meanDelta, 0);
});

test('RefkitBridge fails when meanDelta > 7.0 even if all individual probes pass', async () => {
  const mockUvRunner = async (args: string[]) => {
    if (args.includes('batch')) {
      return `
probe                 ref        mine       delta
bg                    #FFFFFF    #FFFFFF     0.0
title-ink             #1D1D1F    #1D1D1F     0.0
mean Δ 8.20   worst 24px bands:
`;
    }
    return '';
  };

  const bridge = new RefkitBridge('/path/to/uv', '/path/to/refkit.py', mockUvRunner);
  const report = await bridge.runBatch('/tmp/probes.json', '/tmp/renders', 3.0);

  assert.equal(report.meanDelta, 8.2);
  assert.equal(report.passed, false, 'Should fail when meanDelta exceeds 7.0');
});

test('RefkitBridge flags probe as failed when output contains differs', async () => {
  const mockUvRunner = async (args: string[]) => {
    if (args.includes('batch')) {
      return `
probe                 ref        mine       delta
bg                    #FFFFFF    #FFFFFF     0.0
content-band          bands-ref  bands-mine  differs
mean Δ 1.50   worst 24px bands:
`;
    }
    return '';
  };

  const bridge = new RefkitBridge('/path/to/uv', '/path/to/refkit.py', mockUvRunner);
  const report = await bridge.runBatch('/tmp/probes.json', '/tmp/renders', 3.0);

  assert.equal(report.passed, false);
  const bandProbe = report.probeResults.find((p) => p.probeId === 'content-band');
  assert.ok(bandProbe);
  assert.equal(bandProbe.passed, false);
});
