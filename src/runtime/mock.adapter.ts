import type { ICliAdapter, CliExecuteParams, CliExecutionResult } from './adapter.interface.ts';

export type MockBehavior = (params: CliExecuteParams) => Promise<CliExecutionResult>;

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
    const behavior = this.behaviors[this.callCount] ?? (async () => ({
      exitCode: 0,
      stdout: 'Default mock execution',
      stderr: '',
      durationMs: 5
    }));
    this.callCount++;
    return behavior(params);
  }
}
