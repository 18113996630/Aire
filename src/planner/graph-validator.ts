/**
 * AIRE Deterministic Task Graph Validator
 *
 * Enforces 6 layers of engineering semantics and physical constraints on TaskGraphConfig:
 * 1. Schema Integrity (version, project name, scheme, non-empty tasks)
 * 2. DAG Structural Integrity (duplicate IDs, unknown dependencies, cycle detection)
 * 3. File Boundary Safety & Causality (non-empty allowed_files, independent tasks file overlap prevention)
 * 4. Non-Empty Safeguards (goal, role, non-empty acceptance_criteria)
 * 5. Verification Capability Feasibility (build/test/visual validity, reference existence)
 * 6. Structured Diagnostic Reporting (error vs warning)
 */

import type { TaskGraphConfig, TaskNode } from '../dag/types.ts';
import { TaskGraph, DuplicateTaskIdError, CycleDetectedError } from '../dag/task-graph.ts';
import type { ValidationReport, ValidationDiagnostic } from './types.ts';

export class GraphValidator {
  /**
   * Validate a TaskGraphConfig object against all 6 integrity layers.
   */
  static validate(config: TaskGraphConfig): ValidationReport {
    const diagnostics: ValidationDiagnostic[] = [];

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
      if (!config.project.name || config.project.name.trim().length === 0) {
        diagnostics.push({
          rule: 'schema.project.name',
          severity: 'error',
          message: 'Project name must be a non-empty string.',
        });
      }
      if (!config.project.targetScheme || config.project.targetScheme.trim().length === 0) {
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

    // Layer 2: DAG Structural Integrity (Duplicate IDs, Cycles, Unknown Dependencies)
    let graph: TaskGraph | null = null;
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

    // Layer 3 & 4: Task-Level Safeguards & File Boundaries
    const tasks = config.tasks;
    for (const task of tasks) {
      // Non-empty safeguards
      if (!task.id || task.id.trim().length === 0) {
        diagnostics.push({
          rule: 'task.id',
          severity: 'error',
          message: 'Task must have a non-empty "id".',
        });
      }

      if (!task.title || task.title.trim().length === 0) {
        diagnostics.push({
          rule: 'task.title',
          taskId: task.id,
          severity: 'warning',
          message: `Task "${task.id}" should have a descriptive title.`,
        });
      }

      if (!task.goal || task.goal.trim().length === 0) {
        diagnostics.push({
          rule: 'task.goal',
          taskId: task.id,
          severity: 'error',
          message: `Task "${task.id}" must define a non-empty "goal".`,
        });
      }

      if (!task.role || task.role.trim().length === 0) {
        diagnostics.push({
          rule: 'task.role',
          taskId: task.id,
          severity: 'error',
          message: `Task "${task.id}" must define a non-empty "role".`,
        });
      }

      if (!Array.isArray(task.acceptance_criteria) || task.acceptance_criteria.length === 0) {
        diagnostics.push({
          rule: 'task.acceptance_criteria',
          taskId: task.id,
          severity: 'error',
          message: `Task "${task.id}" must declare at least one acceptance criterion in "acceptance_criteria".`,
        });
      }

      // File boundary non-empty safeguard
      if (!Array.isArray(task.allowed_files) || task.allowed_files.length === 0) {
        diagnostics.push({
          rule: 'task.allowed_files.empty',
          taskId: task.id,
          severity: 'error',
          message: `Task "${task.id}" must declare a non-empty "allowed_files" whitelist to maintain atomic boundary safety.`,
        });
      }

      // Layer 5: Verification Capability Feasibility
      if (!task.verification || typeof task.verification !== 'object') {
        diagnostics.push({
          rule: 'task.verification',
          taskId: task.id,
          severity: 'error',
          message: `Task "${task.id}" must declare a "verification" block.`,
        });
      } else {
        const hasBuild = !!task.verification.build;
        const hasTest = !!task.verification.test;
        const hasVisual = !!task.verification.visual;

        if (!hasBuild && !hasTest && !hasVisual) {
          diagnostics.push({
            rule: 'task.verification.none',
            taskId: task.id,
            severity: 'error',
            message: `Task "${task.id}" verification block must specify at least one active evaluator (build, test, or visual).`,
          });
        }

        if (hasVisual && typeof task.verification.visual === 'object') {
          if (!task.verification.visual.reference || task.verification.visual.reference.trim().length === 0) {
            diagnostics.push({
              rule: 'task.verification.visual.reference',
              taskId: task.id,
              severity: 'error',
              message: `Task "${task.id}" specifies visual verification but missing "visual.reference" image path.`,
            });
          }
        }
      }
    }

    // Layer 3 Continued: File Boundary Overlap Causality Check
    if (graph) {
      // Check every pair of tasks for overlapping files
      for (let i = 0; i < tasks.length; i++) {
        for (let j = i + 1; j < tasks.length; j++) {
          const taskA = tasks[i];
          const taskB = tasks[j];
          if (!taskA.allowed_files || !taskB.allowed_files) continue;

          const filesA = new Set(taskA.allowed_files);
          const commonFiles = taskB.allowed_files.filter((f) => filesA.has(f));

          if (commonFiles.length > 0) {
            // Task A and Task B touch the same file.
            // Check if there is a dependency path between them in either direction.
            const aDependents = graph.getTransitiveDependents(taskA.id);
            const bDependents = graph.getTransitiveDependents(taskB.id);

            const bDependsOnA = aDependents.some((node) => node.id === taskB.id);
            const aDependsOnB = bDependents.some((node) => node.id === taskA.id);

            if (!bDependsOnA && !aDependsOnB) {
              diagnostics.push({
                rule: 'task.file_boundary.overlap_conflict',
                taskId: taskB.id,
                severity: 'error',
                message: `Independent concurrent tasks "${taskA.id}" and "${taskB.id}" touch overlapping file(s) [${commonFiles.join(', ')}] without causal dependency.`,
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
