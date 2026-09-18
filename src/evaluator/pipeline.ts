import type { IEvaluator } from './evaluator.interface.ts';
import type { TaskContext, EvaluationResult } from '../core/types.ts';

export class EvaluatorPipeline implements IEvaluator {
  readonly name = 'EvaluatorPipeline';
  private evaluators: IEvaluator[];

  constructor(evaluators: IEvaluator[]) {
    this.evaluators = evaluators;
  }

  async evaluate(context: TaskContext): Promise<EvaluationResult> {
    let lastSuccessResult: EvaluationResult = {
      passed: true,
      type: 'BUILD',
      summary: 'Empty pipeline',
      errors: [],
    };

    for (const evaluator of this.evaluators) {
      const result = await evaluator.evaluate(context);
      if (!result.passed) {
        return result;
      }
      lastSuccessResult = result;
    }

    return lastSuccessResult;
  }
}
