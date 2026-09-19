import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import { EvidenceCollector, type IOcrExtractor } from '../../../src/analysis/evidence-collector.ts';

describe('EvidenceCollector', () => {
  test('parsePngHeader parses actual fixtures/MiniApp/reference.png correctly', async () => {
    const pngPath = path.resolve('fixtures/MiniApp/reference.png');
    const buf = await fs.readFile(pngPath);
    const result = EvidenceCollector.parsePngHeader(buf);

    assert.ok(result.width > 0);
    assert.ok(result.height > 0);
    assert.equal(result.colorSpace, 'sRGB');
  });

  test('parseJpegHeader parses synthesized binary JPEG header correctly', () => {
    // Construct synthetic JPEG buffer with SOF0 (0xFF, 0xC0)
    // Width = 400 (0x0190), Height = 600 (0x0258)
    const jpegHeader = Buffer.from([
      0xff, 0xd8, // SOI
      0xff, 0xe0, 0x00, 0x10, // APP0 length 16
      0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      0xff, 0xc0, 0x00, 0x11, // SOF0 length 17
      0x08, // precision 8
      0x02, 0x58, // height = 600
      0x01, 0x90, // width = 400
      0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, // components
      0xff, 0xd9, // EOI
    ]);

    const result = EvidenceCollector.parseJpegHeader(jpegHeader);
    assert.equal(result.width, 400);
    assert.equal(result.height, 600);
    assert.equal(result.colorSpace, 'sRGB');
  });

  test('parseJpegHeader detects Display P3 ICC profile in APP2', () => {
    const p3Marker = Buffer.from('ICC_PROFILE\0Display P3 Profile Data Marker');
    const app2Length = p3Marker.length + 2;
    const jpegWithP3 = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe2, (app2Length >> 8) & 0xff, app2Length & 0xff]),
      p3Marker,
      Buffer.from([
        0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x00, 0x01, 0x00, 0x03, 0x01, 0x11, 0x00, 0xff, 0xd9,
      ]),
    ]);

    const result = EvidenceCollector.parseJpegHeader(jpegWithP3);
    assert.equal(result.width, 256);
    assert.equal(result.height, 256);
    assert.equal(result.colorSpace, 'DisplayP3');
  });

  test('samples dominant colors and invokes OCR extractor', async () => {
    const mockOcr: IOcrExtractor = {
      async extractText() {
        return [
          { text: 'MiniApp Header', bounds: [10, 20, 100, 40] },
          { text: 'Tap to start', bounds: [50, 150, 200, 180] },
        ];
      },
    };

    const collector = new EvidenceCollector({
      ocrExtractor: mockOcr,
      colorSampler: async () => ['#0A84FF', '#1C1C1E', '#FFFFFF'],
    });

    const evidence = await collector.collect({
      referenceFile: path.resolve('fixtures/MiniApp/reference.png'),
    });

    assert.equal(evidence.images.length, 1);
    const img = evidence.images[0];
    assert.deepEqual(img.dominantColors, ['#0A84FF', '#1C1C1E', '#FFFFFF']);
    assert.ok(img.ocrTextBlocks);
    assert.equal(img.ocrTextBlocks.length, 2);
    assert.equal(img.ocrTextBlocks[0].text, 'MiniApp Header');
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
