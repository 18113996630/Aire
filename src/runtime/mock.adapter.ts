import type { ICliAdapter, CliExecuteParams, CliExecutionResult } from './adapter.interface.ts';

export type MockBehavior =
  | ((params: CliExecuteParams) => Promise<CliExecutionResult>)
  | Partial<CliExecutionResult>;

export class MockCliAdapter implements ICliAdapter {
  readonly name = 'MockCli';
  private callCount = 0;
  private behaviors: MockBehavior[];

  constructor(behaviors: MockBehavior[] = []) {
    this.behaviors = behaviors;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(params: CliExecuteParams): Promise<CliExecutionResult> {
    const behavior = this.behaviors[this.callCount];
    this.callCount++;

    if (!behavior) {
      return {
        exitCode: 0,
        stdout: 'Default mock execution',
        stderr: '',
        durationMs: 5
      };
    }

    if (typeof behavior === 'function') {
      return behavior(params);
    }

    return {
      exitCode: behavior.exitCode ?? 0,
      stdout: behavior.stdout ?? '',
      stderr: behavior.stderr ?? '',
      durationMs: behavior.durationMs ?? 5
    };
  }
}
