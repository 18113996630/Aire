import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HarnessInstaller } from '../../../src/harness/harness-installer.ts';

function expect<T>(actual: T) {
  return {
    toBe(expected: any) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected: any) {
      assert.deepStrictEqual(actual, expected);
    },
    toBeDefined() {
      assert.notStrictEqual(actual, undefined);
    },
    toHaveLength(expected: number) {
      assert.strictEqual((actual as any)?.length, expected);
    },
    toContain(item: any) {
      assert.ok((actual as any)?.includes(item));
    },
    toBeTruthy() {
      assert.ok(actual);
    },
    toBeFalsy() {
      assert.ok(!actual);
    },
  };
}

describe('HarnessInstaller', () => {
  it('installs AIREUITests template files into target project directory', async () => {
    const tmpDir = path.resolve(process.cwd(), 'node_modules/.tmp/harness-test');
    await fs.mkdir(tmpDir, { recursive: true });

    const installer = new HarnessInstaller();
    const installedFiles = await installer.installTemplateFiles(tmpDir);

    const runnerPath = path.join(tmpDir, 'AIREUITests', 'FlowTestRunner.swift');
    const modelsPath = path.join(tmpDir, 'AIREUITests', 'FlowModels.swift');
    const executorPath = path.join(tmpDir, 'AIREUITests', 'XCUIActionExecutor.swift');
    const snapshotPath = path.join(tmpDir, 'AIREUITests', 'SnapshotCapture.swift');

    expect(await fs.stat(runnerPath)).toBeDefined();
    expect(await fs.stat(modelsPath)).toBeDefined();
    expect(await fs.stat(executorPath)).toBeDefined();
    expect(await fs.stat(snapshotPath)).toBeDefined();

    expect(installedFiles).toContain(runnerPath);
    expect(installedFiles).toContain(modelsPath);
    expect(installedFiles).toContain(executorPath);
    expect(installedFiles).toContain(snapshotPath);

    const runnerContent = await fs.readFile(runnerPath, 'utf8');
    expect(runnerContent).toContain('class FlowTestRunner: XCTestCase');
    expect(runnerContent).toContain('TEST_RUNNER_FLOW_FILE_PATH');
    expect(runnerContent).toContain('TEST_RUNNER_ARTIFACT_DIR');

    const modelsContent = await fs.readFile(modelsPath, 'utf8');
    expect(modelsContent).toContain('struct FlowDefinition: Codable');
    expect(modelsContent).toContain('struct FlowExecutionReport: Codable');

    const executorContent = await fs.readFile(executorPath, 'utf8');
    expect(executorContent).toContain('class XCUIActionExecutor');
    expect(executorContent).toContain('coordinate(withNormalizedOffset:');

    const snapshotContent = await fs.readFile(snapshotPath, 'utf8');
    expect(snapshotContent).toContain('class SnapshotCapture');
    expect(snapshotContent).toContain('flow.screen.');
  });

  it('generates shared scheme XML with correct TestAction configuration', async () => {
    const tmpProj = path.resolve(process.cwd(), 'node_modules/.tmp/harness-test/Sample.xcodeproj');
    await fs.mkdir(tmpProj, { recursive: true });

    const installer = new HarnessInstaller();
    const schemePath = await installer.generateSharedScheme(tmpProj, 'AIREUITests', 'Sample');

    expect(await fs.stat(schemePath)).toBeDefined();
    const xml = await fs.readFile(schemePath, 'utf8');
    expect(xml).toContain('<Scheme');
    expect(xml).toContain('<TestAction');
    expect(xml).toContain('BlueprintName = "AIREUITests"');
    expect(xml).toContain('ReferencedContainer = "container:Sample.xcodeproj"');
  });

  it('ensureHarness executes complete installation and scheme generation', async () => {
    const tmpProj = path.resolve(process.cwd(), 'node_modules/.tmp/harness-test-e2e/MyApp.xcodeproj');
    await fs.mkdir(tmpProj, { recursive: true });

    const installer = new HarnessInstaller();
    const result = await installer.ensureHarness(tmpProj, 'MyApp');

    expect(result.templateFiles).toHaveLength(4);
    expect(await fs.stat(result.schemePath)).toBeDefined();
  });
});
