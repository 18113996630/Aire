/**
 * AIRE Deterministic Task Graph Validator
 *
 * Enforces 6 layers of engineering semantics and physical constraints on TaskGraphConfig:
 * 1. Schema Integrity (version, project name, scheme, non-empty tasks, strict type guards)
 * 2. DAG Structural Integrity (duplicate IDs, unknown dependencies, cycle detection)
 * 3. File Boundary Safety & Causality (non-empty allowed_files, glob/prefix file overlap prevention)
 * 4. Non-Empty Safeguards (goal, role, non-empty acceptance_criteria)
 * 5. Verification Capability Feasibility (build/test/visual validity, reference existence on disk)
 * 6. Structured Diagnostic Reporting (error vs warning)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TaskGraphConfig, TaskNode } from '../dag/types.ts';
import { TaskGraph, DuplicateTaskIdError, CycleDetectedError } from '../dag/task-graph.ts';
import { matchesAllowedFile } from '../dag/serial-workspace-strategy.ts';
import type { ValidationReport, ValidationDiagnostic } from './types.ts';

export interface GraphValidatorOptions {
  projectPath?: string;
}

/**
 * Check if two allowed_files patterns overlap (exact match, glob containment, or directory prefix).
 */
export function patternsOverlap(patternA: string, patternB: string): boolean {
  if (typeof patternA !== 'string' || typeof patternB !== 'string') return false;
  const normA = patternA.replace(/^\.?\//, '');
  const normB = patternB.replace(/^\.?\//, '');
  if (normA === normB) return true;

  if (matchesAllowedFile(normA, normB) || matchesAllowedFile(normB, normA)) {
    return true;
  }

  // Check directory or glob prefix intersection (e.g. "Views/" and "Views/*" or "Sources/Models/" and "Sources/")
  const cleanA = normA.replace(/\*.*$/, '');
  const cleanB = normB.replace(/\*.*$/, '');
  if (cleanA && cleanB) {
    if (cleanA.startsWith(cleanB) || cleanB.startsWith(cleanA)) {
      return true;
    }
  }

  return false;
}

export class GraphValidator {
  /**
   * Validate a TaskGraphConfig object against all 6 integrity layers.
   */
  static validate(config: TaskGraphConfig, options?: GraphValidatorOptions): ValidationReport {
    const diagnostics: ValidationDiagnostic[] = [];

    // Root defensive check
    if (!config || typeof config !== 'object') {
      return {
        valid: false,
        diagnostics: [
          {
            rule: 'schema.root',
            severity: 'error',
            message: 'Configuration must be a valid JSON/YAML object.',
          },
        ],
      };
    }

    // Layer 1: Schema Integrity
    if (!config.version || typeof config.version !== 'string' || config.version.trim().length === 0) {
      diagnostics.push({
        rule: 'schema.version',
        severity: 'error',
        message: 'Root configuration must contain a non-empty "version" string.',
      });
    }

    if (!config.project || typeof config.project !== 'object') {
      diagnostics.push({
        rule: 'schema.project',
        severity: 'error',
        message: 'Root configuration must contain a valid "project" object.',
      });
    } else {
      if (typeof config.project.name !== 'string' || config.project.name.trim().length === 0) {
        diagnostics.push({
          rule: 'schema.project.name',
          severity: 'error',
          message: 'Project name must be a non-empty string.',
        });
      }
      if (typeof config.project.targetScheme !== 'string' || config.project.targetScheme.trim().length === 0) {
        diagnostics.push({
          rule: 'schema.project.targetScheme',
          severity: 'error',
          message: 'Project targetScheme must be a non-empty string.',
        });
      }
    }

    if (!Array.isArray(config.tasks) || config.tasks.length === 0) {
      diagnostics.push({
        rule: 'schema.tasks',
        severity: 'error',
        message: 'Configuration must contain a non-empty "tasks" array.',
      });
      return {
        valid: false,
        diagnostics,
      };
    }

    // Pre-flight type check on each task before building TaskGraph
    let allTaskIdsValid = true;
    const tasks = config.tasks;

    for (let idx = 0; idx < tasks.length; idx++) {
      const task = tasks[idx];
      if (!task || typeof task !== 'object') {
        diagnostics.push({
          rule: 'schema.task',
          severity: 'error',
          message: `Task at index ${idx} must be an object.`,
        });
        allTaskIdsValid = false;
        continue;
      }

      const taskId = (task as any).id;
      if (typeof taskId !== 'string' || taskId.trim().length === 0) {
        diagnostics.push({
          rule: 'task.id',
          severity: 'error',
          message: `Task at index ${idx} must have a non-empty string "id".`,
        });
        allTaskIdsValid = false;
      }
    }

    // Layer 2: DAG Structural Integrity (Duplicate IDs, Cycles, Unknown Dependencies)
    let graph: TaskGraph | null = null;
    if (allTaskIdsValid) {
      try {
        graph = new TaskGraph(config);
      } catch (err: any) {
        if (err instanceof DuplicateTaskIdError) {
          diagnostics.push({
            rule: 'dag.duplicate_id',
            taskId: err.taskId,
            severity: 'error',
            message: err.message,
          });
        } else if (err instanceof CycleDetectedError) {
          diagnostics.push({
            rule: 'dag.cycle_detected',
            severity: 'error',
            message: err.message,
          });
        } else {
          diagnostics.push({
            rule: 'dag.structure',
            severity: 'error',
            message: err.message || 'DAG structure validation failed.',
          });
        }
      }
    }

    // Layer 3 & 4: Task-Level Safeguards & File Boundaries
    for (let idx = 0; idx < tasks.length; idx++) {
      const task = tasks[idx];
      if (!task || typeof task !== 'object') continue;

      const taskIdStr = typeof task.id === 'string' ? task.id : `task[${idx}]`;

      if (task.title !== undefined) {
        if (typeof task.title !== 'string' || task.title.trim().length === 0) {
          diagnostics.push({
            rule: 'task.title',
            taskId: taskIdStr,
            severity: 'warning',
            message: `Task "${taskIdStr}" should have a descriptive title.`,
          });
        }
      }

      if (typeof task.goal !== 'string' || task.goal.trim().length === 0) {
        diagnostics.push({
          rule: 'task.goal',
          taskId: taskIdStr,
          severity: 'error',
          message: `Task "${taskIdStr}" must define a non-empty string "goal".`,
        });
      }

      if (typeof task.role !== 'string' || task.role.trim().length === 0) {
        diagnostics.push({
          rule: 'task.role',
          taskId: taskIdStr,
          severity: 'error',
          message: `Task "${taskIdStr}" must define a non-empty string "role".`,
        });
      }

      if (!Array.isArray(task.acceptance_criteria) || task.acceptance_criteria.length === 0) {
        diagnostics.push({
          rule: 'task.acceptance_criteria',
          taskId: taskIdStr,
          severity: 'error',
          message: `Task "${taskIdStr}" must declare at least one acceptance criterion in "acceptance_criteria".`,
        });
      }

      // File boundary non-empty safeguard
      if (!Array.isArray(task.allowed_files) || task.allowed_files.length === 0) {
        diagnostics.push({
          rule: 'task.allowed_files.empty',
          taskId: taskIdStr,
          severity: 'error',
          message: `Task "${taskIdStr}" must declare a non-empty "allowed_files" whitelist to maintain atomic boundary safety.`,
        });
      }

      // Layer 5: Verification Capability Feasibility
      if (!task.verification || typeof task.verification !== 'object') {
        diagnostics.push({
          rule: 'task.verification',
          taskId: taskIdStr,
          severity: 'error',
          message: `Task "${taskIdStr}" must declare a "verification" block.`,
        });
      } else {
        const hasBuild = !!task.verification.build;
        const hasTest = !!task.verification.test;
        const hasVisual = !!task.verification.visual;

        if (!hasBuild && !hasTest && !hasVisual) {
          diagnostics.push({
            rule: 'task.verification.none',
            taskId: taskIdStr,
            severity: 'error',
            message: `Task "${taskIdStr}" verification block must specify at least one active evaluator (build, test, or visual).`,
          });
        }

        if (hasVisual && typeof task.verification.visual === 'object') {
          const ref = task.verification.visual.reference;
          if (typeof ref !== 'string' || ref.trim().length === 0) {
            diagnostics.push({
              rule: 'task.verification.visual.reference',
              taskId: taskIdStr,
              severity: 'error',
              message: `Task "${taskIdStr}" specifies visual verification but missing "visual.reference" image path.`,
            });
          } else if (options?.projectPath) {
            const resolvedPath = path.isAbsolute(ref) ? ref : path.resolve(options.projectPath, ref);
            if (!fs.existsSync(resolvedPath)) {
              diagnostics.push({
                rule: 'task.verification.visual.reference_not_found',
                taskId: taskIdStr,
                severity: 'error',
                message: `Task "${taskIdStr}" references visual reference image "${ref}" which does not exist on disk at "${resolvedPath}".`,
              });
            }
          }
        }
      }
    }

    // Layer 3 Continued: File Boundary Overlap Causality Check (Supporting Glob & Prefix)
    if (graph) {
      for (let i = 0; i < tasks.length; i++) {
        for (let j = i + 1; j < tasks.length; j++) {
          const taskA = tasks[i];
          const taskB = tasks[j];
          if (!taskA || !taskB || !Array.isArray(taskA.allowed_files) || !Array.isArray(taskB.allowed_files)) {
            continue;
          }

          const overlappingFiles: string[] = [];
          for (const patternA of taskA.allowed_files) {
            for (const patternB of taskB.allowed_files) {
              if (patternsOverlap(patternA, patternB)) {
                overlappingFiles.push(`${patternA} overlaps ${patternB}`);
              }
            }
          }

          if (overlappingFiles.length > 0) {
            // Check causal dependency
            const aDependents = graph.getTransitiveDependents(taskA.id);
            const bDependents = graph.getTransitiveDependents(taskB.id);

            const bDependsOnA = aDependents.some((node) => node.id === taskB.id);
            const aDependsOnB = bDependents.some((node) => node.id === taskA.id);

            if (!bDependsOnA && !aDependsOnB) {
              diagnostics.push({
                rule: 'task.file_boundary.overlap_conflict',
                taskId: taskB.id,
                severity: 'error',
                message: `Independent concurrent tasks "${taskA.id}" and "${taskB.id}" touch overlapping file(s) [${overlappingFiles.join(', ')}] without causal dependency.`,
              });
            }
          }
        }
      }
    }

    const hasErrors = diagnostics.some((d) => d.severity === 'error');

    return {
      valid: !hasErrors,
      diagnostics,
    };
  }
}
