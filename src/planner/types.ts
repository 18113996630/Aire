/**
 * AIRE Planner & Compiler Types
 */

import type { TaskGraphConfig } from '../dag/types.ts';

export type DiagnosticSeverity = 'error' | 'warning';

export interface ValidationDiagnostic {
  rule: string;
  taskId?: string;
  severity: DiagnosticSeverity;
  message: string;
}

export interface ValidationReport {
  valid: boolean;
  diagnostics: ValidationDiagnostic[];
}

export interface TaskGraphCompilerOptions {
  includeVisualVerification?: boolean;
  maxRetries?: number;
}
