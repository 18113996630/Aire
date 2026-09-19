import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { AnalysisPipeline } from '../../../src/analysis/analysis-pipeline.ts';

describe('AnalysisPipeline', () => {
  test('executes progressive hydration pipeline and exports JSON IR and Markdown specs with reference path contract', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aire-pipeline-'));
    const prdPath = path.join(tmpDir, 'prd.md');
    await fs.writeFile(
      prdPath,
      `# MiniApp Specifications\n## Feature 1: Greeting\nDisplay greeting card with customizable message.\n`,
      'utf-8'
    );

    const pipeline = new AnalysisPipeline();
    const result = await pipeline.run({
      appName: 'MiniApp',
      projectPath: tmpDir,
      referenceFile: path.resolve('fixtures/MiniApp/reference.png'),
      prdFile: prdPath,
      exportMarkdown: true,
    });

    // 1. Assert IR structure
    assert.equal(result.ir.appName, 'MiniApp');
    assert.ok(result.ir.tokens.length > 0);
    assert.ok(result.ir.screens.length > 0);
    assert.ok(result.ir.entities.length > 0);
    assert.ok(result.ir.architecture.fileBoundaries.length > 0);

    // 2. Assert Reference Path Contract
    const refImagePath = path.join(tmpDir, '.aire', 'evidence', 'images', 'reference.png');
    const refCopied = await fs.stat(refImagePath).then(() => true).catch(() => false);
    assert.ok(refCopied, 'Reference image must be copied into .aire/evidence/images/');
    assert.equal(result.ir.screens[0].referenceImage, '.aire/evidence/images/reference.png');

    // 3. Assert .aire/analysis-ir.json exists
    const rawJson = await fs.readFile(result.irPath, 'utf-8');
    const parsed = JSON.parse(rawJson);
    assert.equal(parsed.appName, 'MiniApp');

    // 4. Assert Markdown projections exist
    assert.equal(result.exportedMarkdownFiles.length, 3);
    for (const mdPath of result.exportedMarkdownFiles) {
      const exists = await fs.stat(mdPath).then(() => true).catch(() => false);
      assert.ok(exists, `Expected file ${mdPath} to exist`);
      const content = await fs.readFile(mdPath, 'utf-8');
      assert.ok(content.length > 50);
    }

    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
