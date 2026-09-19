/**
 * AIRE Flow Interaction Driver Interface
 *
 * Defines unified driver contract for driving interactions and capturing snapshots
 * across XCUITest (primary) and simctl (fallback / recovery).
 */

import type { ActionTarget, FlowBootstrap } from './types.ts';
import type { StateSnapshot } from './state-snapshot.ts';

export interface ActionResult {
  success: boolean;
  error?: string;
  usedFallback?: boolean;
  targetResolvedBy: 'accessibility' | 'predicate' | 'coordinate' | 'none';
  durationMs: number;
}

export interface IInteractionDriver {
  readonly name: string;
  launch(bundleId: string, bootstrap?: FlowBootstrap): Promise<void>;
  tap(target: ActionTarget, allowFallback?: boolean): Promise<ActionResult>;
  input(target: ActionTarget, text: string): Promise<ActionResult>;
  clear(target: ActionTarget): Promise<ActionResult>;
  swipe(direction: 'up' | 'down' | 'left' | 'right', target?: ActionTarget): Promise<ActionResult>;
  scrollTo(target: ActionTarget): Promise<ActionResult>;
  pressBack(): Promise<ActionResult>;
  wait(ms: number): Promise<void>;
  captureSnapshot(stepId: string, screenshotOutputDir: string): Promise<StateSnapshot>;
  terminate(bundleId: string): Promise<void>;
}
