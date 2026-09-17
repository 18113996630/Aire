export type TaskState =
  | 'IDLE'
  | 'INITIALIZING'
  | 'AGENT_CODING'
  | 'BUILDING'
  | 'EVALUATING'
  | 'FIXING'
  | 'COMMITTING'
  | 'ROLLING_BACK'
  | 'COMPLETED'
  | 'FAILED';

export interface BuildError {
  file: string;
  line: number;
  column: number;
  message: string;
  rawSnippet?: string;
}

export interface EvaluationResult {
  passed: boolean;
  type: 'BUILD' | 'FUNCTIONAL' | 'VISUAL_REVIEW';
  summary: string;
  errors: BuildError[];
}

export interface TaskHistoryItem {
  iteration: number;
  action: 'INITIAL_PROMPT' | 'FIX_PROMPT';
  promptUsed: string;
  cliSummary?: string;
  evaluationResult?: EvaluationResult;
  timestamp: number;
}

export interface TaskContext {
  taskId: string;
  projectPath: string;
  scheme: string;
  taskGoal: string;
  maxRetries: number;
  currentRetry: number;
  state: TaskState;
  branchName?: string;
  initialCommitSha?: string;
  history: TaskHistoryItem[];
}
