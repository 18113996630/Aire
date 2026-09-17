export interface CliExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface CliExecuteParams {
  cwd: string;
  prompt: string;
  timeoutMs?: number;
}

export interface ICliAdapter {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  execute(params: CliExecuteParams): Promise<CliExecutionResult>;
}
