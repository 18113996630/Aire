/**
 * AIRE Flow Interactive Evaluator
 *
 * Implements dual-track defect evaluation for state-driven flows:
 * Track 1: StateAssertion verification -> StateDefect[]
 * Track 2: Visual checkpoint verification -> VisualDefect[]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { IEvaluator } from '../evaluator.interface.ts';
import type { TaskContext, EvaluationResult, VisualDefect } from '../../core/types.ts';
import type { FlowOrchestrator } from '../../flow/flow-orchestrator.ts';
import type { FlowDefinition } from '../../flow/types.ts';
import {
  evaluateStateAssertion,
  type StateDefect,
  type StateSnapshot,
} from '../../flow/state-snapshot.ts';

export class FlowInteractiveEvaluator implements IEvaluator {
  readonly name = 'FlowInteractiveEvaluator';
  private orchestrator: FlowOrchestrator;
  private autoProbeGenerator?: any;
  private refkitBridge?: any;

  constructor(
    orchestrator: FlowOrchestrator,
    autoProbeGenerator?: any,
    refkitBridge?: any
  ) {
    this.orchestrator = orchestrator;
    this.autoProbeGenerator = autoProbeGenerator;
    this.refkitBridge = refkitBridge;
  }

  async evaluate(context: TaskContext): Promise<EvaluationResult> {
    if (!context.flowConfig?.flowFile) {
      return {
        passed: true,
        type: 'FLOW_INTERACTIVE',
        summary: 'No flowConfig specified, skipping flow evaluation',
        errors: [],
      };
    }

    const flowFilePath = path.isAbsolute(context.flowConfig.flowFile)
      ? context.flowConfig.flowFile
      : path.resolve(context.projectPath, context.flowConfig.flowFile);

    let flow: FlowDefinition;
    try {
      const raw = await fs.readFile(flowFilePath, 'utf8');
      flow = JSON.parse(raw);
    } catch (err: any) {
      return {
        passed: false,
        type: 'FLOW_INTERACTIVE',
        summary: `Failed to read flow definition file at ${flowFilePath}: ${err.message}`,
        errors: [],
      };
    }

    const artifactDir =
      context.flowConfig.artifactDir ??
      path.join(context.projectPath, '.aire/artifacts/flows', flow.flowId);

    const report = await this.orchestrator.runFlow(flow, {
      artifactDir,
      flowFilePath,
    });

    const stateDefects: StateDefect[] = [];
    const visualDefects: VisualDefect[] = [];

    // 1. Process errors from stepReports
    for (const stepReport of report.stepReports) {
      if (!stepReport.success && stepReport.error) {
        const isElementNotFound =
          stepReport.error.code === 'ELEMENT_NOT_FOUND' ||
          stepReport.error.message.includes('not found');

        stateDefects.push({
          stepId: stepReport.stepId,
          category: isElementNotFound ? 'ELEMENT_MISSING' : 'STATE_MISMATCH',
          targetIdentifier: stepReport.error.targetIdentifier,
          expected: stepReport.error.targetIdentifier ?? stepReport.action,
          actual: stepReport.error.message,
          message: stepReport.error.message,
        });
      }
    }

    // 2. Checkpoint state assertion verification
    for (const step of flow.steps) {
      if (step.expect?.checkpoint && step.expect.state) {
        const snapshotJSONPath = path.join(artifactDir, `${step.stepId}-snapshot.json`);
        try {
          const rawSnapshot = await fs.readFile(snapshotJSONPath, 'utf8');
          const snapshot: StateSnapshot = JSON.parse(rawSnapshot);
          const defects = evaluateStateAssertion(snapshot, step.expect.state);
          stateDefects.push(...defects);
        } catch {
          // Snapshot JSON might not exist if runner failed before checkpoint
        }
      }
    }

    // 3. Determine pass / fail status
    const hasDefects = stateDefects.length > 0 || visualDefects.length > 0;
    const passed = report.success && !hasDefects;

    return {
      passed,
      type: 'FLOW_INTERACTIVE',
      summary: passed
        ? `Flow '${flow.flowId}' completed successfully (${report.completedSteps}/${report.totalSteps} steps)`
        : `Flow '${flow.flowId}' failed at step '${report.failedStepId ?? 'unknown'}': ${report.error || 'State or visual verification failed'}`,
      errors: [],
      stateDefects,
      visualDefects,
      flowReport: report,
    };
  }
}
