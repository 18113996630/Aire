import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { EvidenceCollector } from '../../../src/analysis/evidence-collector.ts';

describe('EvidenceCollector', () => {
  test('parsePngHeader parses actual fixtures/MiniApp/reference.png correctly', async () => {
    const pngPath = path.resolve('fixtures/MiniApp/reference.png');
    const buf = await fs.readFile(pngPath);
    const result = EvidenceCollector.parsePngHeader(buf);

    assert.ok(result.width > 0);
    assert.ok(result.height > 0);
    assert.equal(result.colorSpace, 'sRGB');
  });

  test('parsePrdMarkdown constructs nested section tree from markdown text', () => {
    const md = `# MiniApp PRD
Overview of the mini app.

## Feature 1: Greeting
Details of greeting.

### Sub-feature 1.1: Custom Text
Allow user to input custom greeting text.

## Feature 2: Settings
App settings.
`;

    const sections = EvidenceCollector.parsePrdMarkdown(md);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].title, 'MiniApp PRD');
    assert.equal(sections[0].subsections.length, 2);
    assert.equal(sections[0].subsections[0].title, 'Feature 1: Greeting');
    assert.equal(sections[0].subsections[0].subsections.length, 1);
    assert.equal(sections[0].subsections[0].subsections[0].title, 'Sub-feature 1.1: Custom Text');
    assert.equal(sections[0].subsections[1].title, 'Feature 2: Settings');
  });

  test('collect aggregates both physical images and PRD sections', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aire-evidence-'));
    const prdPath = path.join(tmpDir, 'prd.md');
    await fs.writeFile(
      prdPath,
      `# Test Requirements\n## UI Flow\nRender greeting card.\n`,
      'utf-8'
    );

    const collector = new EvidenceCollector();
    const evidence = await collector.collect({
      referenceFile: path.resolve('fixtures/MiniApp/reference.png'),
      prdFile: prdPath,
    });

    assert.equal(evidence.images.length, 1);
    assert.ok(evidence.images[0].width > 0);
    assert.equal(evidence.prdSections.length, 1);
    assert.equal(evidence.prdSections[0].title, 'Test Requirements');
    assert.ok(evidence.collectedAt);

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
