import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { AutoProbeGenerator } from '../../src/evaluator/visual/auto-probe-generator.ts';

test('AutoProbeGenerator generates valid probes.json with core probe rows', async () => {
  const tmpOut = path.resolve('/tmp/test-probes.json');
  const generator = new AutoProbeGenerator();

  const generatedPath = await generator.generateProbes({
    referenceImagePath: 'fixtures/MiniApp/reference.png',
    renderedImageName: 'mine.png',
    scale: 3.0,
    outputPath: tmpOut,
  });

  assert.equal(generatedPath, tmpOut);
  const raw = await fs.readFile(tmpOut, 'utf8');
  const probes = JSON.parse(raw);

  assert.ok(Array.isArray(probes));
  assert.ok(probes.some((p: any) => p.id === 'bg-fill'));
  assert.ok(probes.some((p: any) => p.id === 'title-ink'));
  assert.ok(probes.some((p: any) => p.id === 'card-inset'));

  const bgProbe = probes.find((p: any) => p.id === 'bg-fill');
  assert.equal(bgProbe.cmd, 'sample');
  assert.equal(bgProbe.only, 'flat');
  assert.equal(bgProbe.mine, 'mine.png');
});
