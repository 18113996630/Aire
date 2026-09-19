import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SimctlInputDriver } from '../../../src/flow/simctl-input-driver.ts';
import { XCUITestDriver } from '../../../src/flow/xcuitest-driver.ts';
import type { SimctlExecFn } from '../../../src/ios/types.ts';

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

describe('Interaction Drivers', () => {
  it('SimctlInputDriver taps using logical points', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: SimctlExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return '';
    };

    const driver = new SimctlInputDriver('booted', mockExec);

    const result = await driver.tap({
      type: 'coordinate',
      coordinate: { x: 120, y: 340 },
    });

    expect(result.success).toBe(true);
    expect(result.targetResolvedBy).toBe('coordinate');
    expect(result.usedFallback).toBe(false);
    expect(calls.length).toBe(1);
    expect(calls[0].cmd).toBe('xcrun');
    expect(calls[0].args).toEqual(['simctl', 'io', 'booted', 'tap', '120', '340']);
  });

  it('SimctlInputDriver supports coordinate fallback when allowFallback is true', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: SimctlExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return '';
    };

    const driver = new SimctlInputDriver('UDID-123', mockExec);

    const result = await driver.tap(
      {
        type: 'accessibility',
        identifier: 'flow.button.edit',
        coordinate: { x: 200, y: 400 },
      },
      true // allowFallback
    );

    expect(result.success).toBe(true);
    expect(result.targetResolvedBy).toBe('coordinate');
    expect(result.usedFallback).toBe(true);
    expect(calls[0].args).toEqual(['simctl', 'io', 'UDID-123', 'tap', '200', '400']);
  });

  it('SimctlInputDriver fails gracefully when coordinate is absent for accessibility target', async () => {
    const driver = new SimctlInputDriver('booted', async () => '');

    const result = await driver.tap({
      type: 'accessibility',
      identifier: 'flow.button.save',
    });

    expect(result.success).toBe(false);
    expect(result.targetResolvedBy).toBe('none');
    expect(result.error).toBeDefined();
  });

  it('SimctlInputDriver launches app with deepLink or launchArgs bootstrap', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const mockExec: SimctlExecFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return 'PID: 9999';
    };

    const driver = new SimctlInputDriver('UDID-TEST', mockExec);

    await driver.launch('com.example.app', {
      type: 'deepLink',
      value: 'myapp://settings/profile',
    });

    expect(calls.length).toBe(2);
    expect(calls[0].args).toEqual(['simctl', 'launch', 'UDID-TEST', 'com.example.app']);
    expect(calls[1].args).toEqual(['simctl', 'openurl', 'UDID-TEST', 'myapp://settings/profile']);

    calls.length = 0;
    await driver.launch('com.example.app', {
      type: 'launchArgs',
      value: '-AireFlow test -Debug 1',
    });

    expect(calls.length).toBe(1);
    expect(calls[0].args).toEqual(['simctl', 'launch', 'UDID-TEST', 'com.example.app', '-AireFlow', 'test', '-Debug', '1']);
  });

  it('XCUITestDriver prepares execution arguments with Apple standard envs', () => {
    const driver = new XCUITestDriver({
      projectPath: '/path/to/project',
      scheme: 'AIREUITests',
      udid: 'device-123',
    });

    const envs = driver.buildTestRunnerEnvs('/path/to/flow.json', '/path/to/artifacts', 'step-2');
    expect(envs.TEST_RUNNER_FLOW_FILE_PATH).toBe('/path/to/flow.json');
    expect(envs.TEST_RUNNER_ARTIFACT_DIR).toBe('/path/to/artifacts');
    expect(envs.TEST_RUNNER_START_STEP_ID).toBe('step-2');
  });

  it('XCUITestDriver generates correct xcodebuild command line arguments', () => {
    const driver = new XCUITestDriver({
      projectPath: '/path/to/MyProject.xcodeproj',
      scheme: 'AIREUITests',
      udid: 'device-123',
    });

    const cmd = driver.buildXcodebuildCommand();
    expect(cmd.cmd).toBe('xcrun');
    expect(cmd.args).toContain('xcodebuild');
    expect(cmd.args).toContain('test');
    expect(cmd.args).toContain('-project');
    expect(cmd.args).toContain('/path/to/MyProject.xcodeproj');
    expect(cmd.args).toContain('-scheme');
    expect(cmd.args).toContain('AIREUITests');
    expect(cmd.args).toContain('-destination');
    expect(cmd.args).toContain('id=device-123');
    expect(cmd.args).toContain('-only-testing:AIREUITests/FlowTestRunner/testRunFlow');
  });

  it('XCUITestDriver executeFlowBatch parses artifact report on success', async () => {
    const tmpDir = path.resolve(process.cwd(), 'node_modules/.tmp/xcui-test');
    await fs.mkdir(tmpDir, { recursive: true });
    const reportPath = path.join(tmpDir, 'flow-report.json');

    const expectedReport = {
      flowId: 'flow-test',
      success: true,
      totalDurationMs: 300,
      completedSteps: 1,
      totalSteps: 1,
      stepReports: [
        {
          stepId: 'step-1',
          action: 'tap',
          success: true,
          targetResolvedBy: 'accessibility',
          durationMs: 120,
        },
      ],
    };
    await fs.writeFile(reportPath, JSON.stringify(expectedReport), 'utf8');

    const driver = new XCUITestDriver({
      projectPath: '/path/to/project',
      scheme: 'AIREUITests',
      udid: 'booted',
      execFn: async () => ({ stdout: 'Test Passed', stderr: '' }),
    });

    const report = await driver.executeFlowBatch({
      flowFilePath: '/path/to/flow.json',
      artifactDir: tmpDir,
    });

    expect(report.success).toBe(true);
    expect(report.flowId).toBe('flow-test');
    expect(report.completedSteps).toBe(1);
  });
});
