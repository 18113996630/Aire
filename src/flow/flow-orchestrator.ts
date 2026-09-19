/**
 * AIRE Flow Orchestrator
 *
 * Coordinates execution of multi-step flows, manages Level 1 & Level 2 fallback continuity,
 * handles external simctl physical recovery, and aggregates consolidated flow reports.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  FlowDefinition,
  FlowExecutionReport,
  FlowStepReport,
} from './types.ts';
import type { IInteractionDriver } from './interaction-driver.interface.ts';

export interface FlowRunOptions {
  artifactDir: string;
  flowFilePath?: string;
  maxFallbackRetries?: number;
  enableLevel2Fallback?: boolean;
}

export class FlowOrchestrator {
  private primaryDriver: any;
  private fallbackDriver?: IInteractionDriver | any;

  constructor(primaryDriver: any, fallbackDriver?: IInteractionDriver | any) {
    this.primaryDriver = primaryDriver;
    this.fallbackDriver = fallbackDriver;
  }

  async runFlow(
    flow: FlowDefinition,
    options: FlowRunOptions
  ): Promise<FlowExecutionReport> {
    await fs.mkdir(options.artifactDir, { recursive: true });

    let flowFilePath = options.flowFilePath;
    if (!flowFilePath) {
      flowFilePath = path.join(options.artifactDir, `${flow.flowId}.json`);
      await fs.writeFile(flowFilePath, JSON.stringify(flow, null, 2), 'utf8');
    }

    // 1. Primary execution via batch runner (XCUITestDriver or mock)
    if (typeof this.primaryDriver?.executeFlowBatch === 'function') {
      let report: FlowExecutionReport = await this.primaryDriver.executeFlowBatch({
        flowFilePath,
        artifactDir: options.artifactDir,
      });

      // If all passed or Level 2 fallback is disabled, return directly
      if (report.success || options.enableLevel2Fallback === false) {
        return report;
      }

      // Check if failure is eligible for Level 2 Fallback
      if (report.failedStepId && this.fallbackDriver) {
        const failedIndex = flow.steps.findIndex((s) => s.stepId === report.failedStepId);
        if (failedIndex >= 0) {
          const failedStep = flow.steps[failedIndex];

          if (failedStep.allowCoordinateFallback && failedStep.target?.coordinate) {
            // Execute fallback tap via fallbackDriver (e.g. SimctlInputDriver)
            const fallbackResult = await this.fallbackDriver.tap(failedStep.target, true);

            if (fallbackResult.success) {
              // Update failed step in original report
              report.stepReports[failedIndex] = {
                stepId: failedStep.stepId,
                action: failedStep.action,
                success: true,
                targetResolvedBy: 'coordinate',
                usedFallback: true,
                durationMs:
                  (report.stepReports[failedIndex]?.durationMs ?? 0) + fallbackResult.durationMs,
              };

              // If there are subsequent steps, resume runner from next step
              if (failedIndex + 1 < flow.steps.length) {
                const nextStepId = flow.steps[failedIndex + 1].stepId;
                const resumeReport: FlowExecutionReport = await this.primaryDriver.executeFlowBatch(
                  {
                    flowFilePath,
                    artifactDir: options.artifactDir,
                    startStepId: nextStepId,
                  }
                );

                // Merge resumed step reports
                const newStepReports: FlowStepReport[] = [...report.stepReports.slice(0, failedIndex + 1)];
                for (const r of resumeReport.stepReports) {
                  const alreadyExists = newStepReports.some((existing) => existing.stepId === r.stepId);
                  if (!alreadyExists) {
                    newStepReports.push(r);
                  }
                }

                const totalCompleted = newStepReports.filter((s) => s.success).length;
                report = {
                  flowId: flow.flowId,
                  success: resumeReport.success,
                  totalDurationMs:
                    report.totalDurationMs + resumeReport.totalDurationMs + fallbackResult.durationMs,
                  completedSteps: totalCompleted,
                  totalSteps: flow.steps.length,
                  stepReports: newStepReports,
                  failedStepId: resumeReport.failedStepId,
                  error: resumeReport.error,
                };
              } else {
                // The failed step was the final step; now everything succeeded
                report.success = true;
                report.completedSteps = flow.steps.length;
                report.failedStepId = undefined;
                report.error = undefined;
              }
            }
          }
        }
      }

      return report;
    }

    // 2. Step-by-step driver execution (if primary is an IInteractionDriver instance)
    const startTime = Date.now();
    const stepReports: FlowStepReport[] = [];
    let failedStepId: string | undefined = undefined;
    let errorMessage: string | undefined = undefined;

    if (typeof this.primaryDriver?.launch === 'function') {
      await this.primaryDriver.launch(flow.flowId, flow.bootstrap);
    }

    for (const step of flow.steps) {
      const stepStart = Date.now();
      let result = await this.primaryDriver.tap(step.target, step.allowCoordinateFallback);

      if (!result.success && step.allowCoordinateFallback && this.fallbackDriver && step.target?.coordinate) {
        result = await this.fallbackDriver.tap(step.target, true);
      }

      const durationMs = Date.now() - stepStart;
      if (result.success) {
        stepReports.push({
          stepId: step.stepId,
          action: step.action,
          success: true,
          targetResolvedBy: result.targetResolvedBy,
          usedFallback: result.usedFallback,
          durationMs,
        });
      } else {
        failedStepId = step.stepId;
        errorMessage = result.error;
        stepReports.push({
          stepId: step.stepId,
          action: step.action,
          success: false,
          targetResolvedBy: result.targetResolvedBy,
          usedFallback: result.usedFallback,
          durationMs,
          error: {
            code: 'ACTION_FAILED',
            message: result.error || 'Step execution failed',
            targetIdentifier: step.target?.identifier,
          },
        });
        break;
      }
    }

    return {
      flowId: flow.flowId,
      success: failedStepId === undefined,
      totalDurationMs: Date.now() - startTime,
      completedSteps: stepReports.filter((s) => s.success).length,
      totalSteps: flow.steps.length,
      stepReports,
      failedStepId,
      error: errorMessage,
    };
  }
}
