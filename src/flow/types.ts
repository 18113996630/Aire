/**
 * AIRE Flow DSL & Schema SSOT Types
 *
 * Defines core TypeScript types and contracts for state-space interactive flow execution,
 * snapshot validation, and dual-track QA reports.
 */

export type TargetType = 'accessibility' | 'coordinate' | 'predicate';

export interface Coordinate {
  /** Logical point X in SwiftUI coordinate space (pt) */
  x: number;
  /** Logical point Y in SwiftUI coordinate space (pt) */
  y: number;
}

export interface ActionTarget {
  /** Target resolution strategy. Preferred: accessibility */
  type: TargetType;
  /** Semantic identifier namespace, e.g. "flow.button.edit", "flow.cell.transaction.0" */
  identifier?: string;
  /** Logical points (pt) in SwiftUI coordinates, used in fallback or coordinate mode */
  coordinate?: Coordinate;
  /** XCUIElementQuery Predicate, e.g. "label CONTAINS 'Total'" */
  predicate?: string;
}

export type FlowActionType =
  | 'launch'
  | 'tap'
  | 'input'
  | 'clear'
  | 'swipe'
  | 'scrollTo'
  | 'pressBack'
  | 'wait';

export interface ElementAssertion {
  target: ActionTarget;
  enabled?: boolean;
  textEquals?: string;
  textContains?: string;
}

export interface StateAssertion {
  elementsExist?: ElementAssertion[];
  elementsNotExist?: ActionTarget[];
  keyboardVisible?: boolean;
  expectedRoute?: string;
}

export interface VisualProbeTolerance {
  containerDeltaMax?: number;
  spacingPtMax?: number;
  textDeltaMax?: number;
}

export interface VisualProbesExpectation {
  focusArea?: string;
  tolerance?: VisualProbeTolerance;
}

export interface StepExpectation {
  checkpoint?: boolean;
  referenceImage?: string;
  state?: StateAssertion;
  visualProbes?: VisualProbesExpectation;
}

export interface FlowStepDefinition {
  stepId: string;
  action: FlowActionType;
  target?: ActionTarget;
  value?: string;
  timeoutMs?: number;
  /** Whether to allow in-process or simctl fallback to coordinate tap (default: false) */
  allowCoordinateFallback?: boolean;
  expect?: StepExpectation;
}

export interface FlowBootstrap {
  type: 'deepLink' | 'launchArgs';
  value: string;
  environment?: Record<string, string>;
}

export interface FlowDefinition {
  schemaVersion: '1.0';
  flowId: string;
  name: string;
  description: string;
  bootstrap?: FlowBootstrap;
  steps: FlowStepDefinition[];
}

export interface FlowStepError {
  code: string;
  message: string;
  targetIdentifier?: string;
}

export type TargetResolvedBy = 'accessibility' | 'predicate' | 'coordinate' | 'none';

export interface FlowStepReport {
  stepId: string;
  action: FlowActionType;
  success: boolean;
  targetResolvedBy: TargetResolvedBy;
  durationMs: number;
  error?: FlowStepError;
  usedFallback?: boolean;
  snapshotPath?: string;
}

export interface FlowExecutionReport {
  flowId: string;
  success: boolean;
  totalDurationMs: number;
  completedSteps: number;
  totalSteps: number;
  stepReports: FlowStepReport[];
  failedStepId?: string;
  error?: string;
}
