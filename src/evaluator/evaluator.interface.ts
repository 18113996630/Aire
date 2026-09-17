import type { TaskContext, EvaluationResult } from '../core/types.ts';

export interface IEvaluator {
  readonly name: string;
  evaluate(context: TaskContext): Promise<EvaluationResult>;
}
