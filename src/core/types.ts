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

export interface VisualDefect {
  id: string;
  severity: 'critical' | 'high' | 'medium';
  category: 'color' | 'spacing' | 'size' | 'layout';
  element: string;
  probeBox: [number, number, number, number];
  expected: string | number;
  actual: string | number;
  delta: number;
  tolerance: number;
  claim: string;
}

export interface EvaluationResult {
  passed: boolean;
  type: 'BUILD' | 'FUNCTIONAL' | 'VISUAL_REVIEW';
  summary: string;
  errors: BuildError[];
  visualDefects?: VisualDefect[];
  meanDelta?: number;
}

export interface TaskHistoryItem {
  iteration: number;
  action: 'INITIAL_PROMPT' | 'FIX_PROMPT';
  promptUsed: string;
  cliSummary?: string;
  evaluationResult?: EvaluationResult;
  timestamp: number;
}

export interface VisualToleranceMatrix {
  containerDeltaMax: number;
  spacingPtMax: number;
  textDeltaMax: number;
}

export interface VisualReplicaConfig {
  referenceImagePath: string;
  focusAreas?: string;
  toleranceMatrix: VisualToleranceMatrix;
  preferredDevice?: string;
  settleDelayMs?: number;
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
  visualConfig?: VisualReplicaConfig;
  appBundlePath?: string;
  bundleId?: string;
  capturedScreenshotPath?: string;
  generatedProbesPath?: string;
  history: TaskHistoryItem[];
}
