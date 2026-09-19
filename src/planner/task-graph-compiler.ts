/**
 * AIRE Task Graph Compiler
 *
 * Compiles a hydrated Analysis IR into a strongly-typed, topologically-sound TaskGraphConfig.
 * Fully consumes IR:
 * - Requirements mapped to data, viewModel, and view acceptance criteria
 * - Tokens mapped to UI design specifications and visual probes
 * - Flows and multi-screen architecture mapped to Navigation & Coordinator tasks
 * - Validates the resulting configuration deterministically via GraphValidator.
 */

import type { AnalysisIR } from '../analysis/types.ts';
import type { TaskGraphConfig, TaskNode } from '../dag/types.ts';
import { GraphValidator } from './graph-validator.ts';
import type { TaskGraphCompilerOptions } from './types.ts';

export class CompilerValidationError extends Error {
  public readonly diagnostics: any[];

  constructor(message: string, diagnostics: any[]) {
    super(message);
    this.name = 'CompilerValidationError';
    this.diagnostics = diagnostics;
  }
}

export class TaskGraphCompiler {
  private options: TaskGraphCompilerOptions;

  constructor(options?: TaskGraphCompilerOptions) {
    this.options = options ?? {};
  }

  /**
   * Compiles AnalysisIR to validated TaskGraphConfig.
   */
  compile(ir: AnalysisIR): TaskGraphConfig {
    const tasks: TaskNode[] = [];
    const modelTaskIds: string[] = [];
    const viewModelTaskIds: string[] = [];
    const viewTaskIds: string[] = [];

    // Group requirements by category
    const dataReqs = ir.requirements.filter((r) => r.category === 'data');
    const funcReqs = ir.requirements.filter((r) => r.category === 'functional');
    const uiReqs = ir.requirements.filter((r) => r.category === 'ui');
    const navReqs = ir.requirements.filter((r) => r.category === 'navigation');

    // 1. Compile Data Entity Tasks (Roots of the DAG)
    for (const entity of ir.entities) {
      const taskId = `task-data-${entity.name.toLowerCase()}`;
      const modelFile = `${ir.appName}/Models/${entity.name}.swift`;
      modelTaskIds.push(taskId);

      const criteria = [
        `${entity.name} compiles cleanly conforming to ${entity.conformance.join(', ')}`,
        `Includes fields: ${entity.fields.map((f) => f.name).join(', ')}`,
      ];

      for (const req of dataReqs) {
        criteria.push(...req.acceptanceCriteria);
      }

      tasks.push({
        id: taskId,
        title: `Implement ${entity.name} Data Model`,
        goal: `Define ${entity.name} domain model conforming to ${entity.conformance.join(', ')}`,
        role: 'iOS Developer',
        dependencies: [],
        dependents: [],
        allowed_files: [modelFile],
        acceptance_criteria: Array.from(new Set(criteria)),
        verification: {
          build: true,
        },
      });
    }

    // Fallback: If no entities defined, create a default foundation task
    if (tasks.length === 0) {
      const defaultTaskId = 'task-data-foundation';
      const defaultModelFile = `${ir.appName}/Models/${ir.appName}Model.swift`;
      modelTaskIds.push(defaultTaskId);

      tasks.push({
        id: defaultTaskId,
        title: `Setup ${ir.appName} Foundation Model`,
        goal: `Define baseline domain model for ${ir.appName}`,
        role: 'iOS Developer',
        dependencies: [],
        dependents: [],
        allowed_files: [defaultModelFile],
        acceptance_criteria: [`${ir.appName}Model compiles cleanly`],
        verification: {
          build: true,
        },
      });
    }

    // 2. Compile ViewModel Tasks (depends on Data Models)
    const vmFiles = ir.architecture.layers.viewModels?.files ?? [];
    for (const vmFile of vmFiles) {
      const vmName = vmFile.split('/').pop()?.replace('.swift', '') ?? `${ir.appName}ViewModel`;
      const taskId = `task-vm-${vmName.toLowerCase()}`;
      viewModelTaskIds.push(taskId);

      const criteria = [
        `${vmName} compiles cleanly and provides state publishers for views`,
      ];
      for (const req of funcReqs) {
        criteria.push(...req.acceptanceCriteria);
      }

      tasks.push({
        id: taskId,
        title: `Implement ${vmName}`,
        goal: `Implement observable state management and domain logic for ${vmName}`,
        role: 'iOS Developer',
        dependencies: [...modelTaskIds],
        dependents: [],
        allowed_files: [vmFile],
        acceptance_criteria: Array.from(new Set(criteria)),
        verification: {
          build: true,
        },
      });
    }

    // 3. Compile View & Visual Verification Tasks (depends on ViewModels or Models)
    const viewDependencies = viewModelTaskIds.length > 0 ? [...viewModelTaskIds] : [...modelTaskIds];

    for (const screen of ir.screens) {
      for (const comp of screen.components) {
        const taskId = `task-view-${comp.name.toLowerCase()}`;
        const viewFile = `${ir.appName}/Views/${comp.name}.swift`;
        viewTaskIds.push(taskId);

        const verification: any = { build: true };

        // Attach visual probe verification if reference image or probe is available
        const hasVisual = this.options.includeVisualVerification !== false;
        if (hasVisual && screen.referenceImage) {
          verification.visual = {
            reference: screen.referenceImage,
            focus: comp.probe?.focus ?? `${comp.name} layout and styling`,
            tolerance: comp.probe?.tolerance ?? {
              containerDeltaMax: 7.0,
              spacingPtMax: 2.0,
              textDeltaMax: 15.0,
            },
          };
        }

        const criteria = [
          `${comp.name} renders according to SwiftUI design specs`,
          ...(comp.tokens.length > 0 ? [`Adheres strictly to tokens: ${comp.tokens.join(', ')}`] : []),
          ...(verification.visual ? ['Passes pixel-level probe verification within tolerance'] : []),
        ];

        for (const req of uiReqs) {
          criteria.push(...req.acceptanceCriteria);
        }

        tasks.push({
          id: taskId,
          title: `Implement ${comp.name}`,
          goal: `Create SwiftUI ${comp.layout} layout for ${comp.name} adhering to ${screen.title} route ${screen.route}`,
          role: 'iOS Developer',
          dependencies: [...viewDependencies],
          dependents: [],
          allowed_files: [viewFile],
          acceptance_criteria: Array.from(new Set(criteria)),
          verification,
        });
      }
    }

    // 4. Compile Navigation & Flow Coordinator Task if multiple screens or navigation requirements exist
    const hasMultipleScreens = ir.screens.length > 1;
    const hasNavFlows = navReqs.length > 0 || (ir.flows.length > 0 && ir.flows.some((f) => f.steps.length > 1));

    if (hasMultipleScreens || hasNavFlows) {
      const navTaskId = `task-nav-coordinator`;
      const navFile = `${ir.appName}/Navigation/${ir.appName}Coordinator.swift`;

      const criteria = [
        `Coordinates routes: ${ir.screens.map((s) => s.route).join(', ')}`,
        `Implements flows: ${ir.flows.map((f) => f.name).join(', ')}`,
      ];
      for (const req of navReqs) {
        criteria.push(...req.acceptanceCriteria);
      }

      tasks.push({
        id: navTaskId,
        title: `Implement ${ir.appName} Navigation Coordinator`,
        goal: `Implement NavigationStack and routing across ${ir.screens.map((s) => s.title).join(', ')}`,
        role: 'iOS Developer',
        dependencies: [...viewTaskIds],
        dependents: [],
        allowed_files: [navFile],
        acceptance_criteria: Array.from(new Set(criteria)),
        verification: {
          build: true,
        },
      });
    }

    const config: TaskGraphConfig = {
      version: '1.0.0',
      project: {
        name: ir.appName,
        targetScheme: ir.targetScheme,
      },
      tasks,
    };

    // 5. Deterministic Semantic Validation
    const report = GraphValidator.validate(config, { projectPath: this.options.projectPath });
    if (!report.valid) {
      const errorMsg = report.diagnostics
        .filter((d) => d.severity === 'error')
        .map((d) => `[${d.rule}] ${d.message}`)
        .join('; ');
      throw new CompilerValidationError(`Compiled TaskGraphConfig failed semantic validation: ${errorMsg}`, report.diagnostics);
    }

    return config;
  }
}
