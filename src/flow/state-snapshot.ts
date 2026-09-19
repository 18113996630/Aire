/**
 * AIRE Flow State Snapshot & Route Three-tier Inference Evaluator
 *
 * Implements StateSnapshot model, ElementSnapshot, StateDefect diagnostics,
 * Route three-tier inference, and state assertion evaluation.
 */

import type { ActionTarget, StateAssertion } from './types.ts';

export interface ElementSnapshot {
  identifier?: string;
  label?: string;
  elementType: string;
  isEnabled: boolean;
  isHittable: boolean;
  frame: { x: number; y: number; width: number; height: number };
  value?: string;
}

export type RouteConfidence = 'exact_identifier' | 'nav_title_inferred' | 'bootstrap_assumed';

export interface StateSnapshot {
  stepId: string;
  timestamp: string;
  screenshotPath: string;
  /** Current observed route / screen */
  route?: string;
  routeConfidence: RouteConfidence;
  keyboardVisible: boolean;
  activeOverlay?: string;
  elements: ElementSnapshot[];
  error?: string;
}

export type StateDefectCategory =
  | 'ELEMENT_MISSING'
  | 'STATE_MISMATCH'
  | 'ROUTE_MISMATCH'
  | 'ACTION_TIMEOUT';

export interface StateDefect {
  stepId: string;
  category: StateDefectCategory;
  targetIdentifier?: string;
  expected: string;
  actual: string;
  message: string;
}

export interface InferRouteOptions {
  titleToRouteMap?: Record<string, string>;
  knownScreens?: Array<{
    id: string;
    name?: string;
    title?: string;
    route?: string;
  }>;
  bootstrapRoute?: string;
}

export interface RouteInferenceResult {
  route?: string;
  routeConfidence: RouteConfidence;
}

/**
 * Three-tier Route Inference:
 * Tier 1 (Root Identifier Contract): Checks if any element's identifier starts with "flow.screen."
 * Tier 2 (Navigation Title Heuristic): Checks navigation bar title against titleToRouteMap or knownScreens
 * Tier 3 (Bootstrap Assumed): Falls back to bootstrapRoute if provided
 */
export function inferRoute(
  elements: ElementSnapshot[],
  options?: InferRouteOptions
): RouteInferenceResult {
  // Tier 1: Exact identifier on screen root container
  const screenElement = elements.find((el) => el.identifier?.startsWith('flow.screen.'));
  if (screenElement && screenElement.identifier) {
    const route = screenElement.identifier.slice('flow.screen.'.length);
    return {
      route,
      routeConfidence: 'exact_identifier',
    };
  }

  // Tier 2: Navigation title heuristic inference
  const navElement = elements.find(
    (el) =>
      el.elementType === 'NavigationBar' ||
      el.elementType.toLowerCase().includes('navigation') ||
      el.identifier?.startsWith('flow.nav.')
  );

  const candidateTitle = navElement?.label ?? navElement?.value;

  if (candidateTitle) {
    // Check against titleToRouteMap
    if (options?.titleToRouteMap) {
      if (options.titleToRouteMap[candidateTitle]) {
        return {
          route: options.titleToRouteMap[candidateTitle],
          routeConfidence: 'nav_title_inferred',
        };
      }
      const lower = candidateTitle.toLowerCase();
      const matchedKey = Object.keys(options.titleToRouteMap).find(
        (key) => key.toLowerCase() === lower
      );
      if (matchedKey && options.titleToRouteMap[matchedKey]) {
        return {
          route: options.titleToRouteMap[matchedKey],
          routeConfidence: 'nav_title_inferred',
        };
      }
    }

    // Check against knownScreens
    if (options?.knownScreens) {
      const lower = candidateTitle.toLowerCase();
      const matchedScreen = options.knownScreens.find(
        (s) =>
          (s.name && s.name.toLowerCase() === lower) ||
          (s.title && s.title.toLowerCase() === lower) ||
          s.id.toLowerCase() === lower
      );
      if (matchedScreen) {
        return {
          route: matchedScreen.route ?? matchedScreen.id,
          routeConfidence: 'nav_title_inferred',
        };
      }
    }
  }

  // Tier 3: Bootstrap assumed
  if (options?.bootstrapRoute) {
    return {
      route: options.bootstrapRoute,
      routeConfidence: 'bootstrap_assumed',
    };
  }

  return {
    route: undefined,
    routeConfidence: 'bootstrap_assumed',
  };
}

/**
 * Creates a StateSnapshot, automatically inferring route and confidence if not provided.
 */
export interface CreateStateSnapshotOptions {
  stepId: string;
  screenshotPath: string;
  elements: ElementSnapshot[];
  keyboardVisible?: boolean;
  activeOverlay?: string;
  timestamp?: string;
  route?: string;
  routeConfidence?: RouteConfidence;
  inferRouteOptions?: InferRouteOptions;
  error?: string;
}

export function createStateSnapshot(options: CreateStateSnapshotOptions): StateSnapshot {
  let route = options.route;
  let routeConfidence = options.routeConfidence;

  if (!route || !routeConfidence) {
    const inferred = inferRoute(options.elements, options.inferRouteOptions);
    route = route ?? inferred.route;
    routeConfidence = routeConfidence ?? inferred.routeConfidence;
  }

  return {
    stepId: options.stepId,
    timestamp: options.timestamp ?? new Date().toISOString(),
    screenshotPath: options.screenshotPath,
    route,
    routeConfidence: routeConfidence ?? 'bootstrap_assumed',
    keyboardVisible: options.keyboardVisible ?? false,
    activeOverlay: options.activeOverlay,
    elements: options.elements,
    error: options.error,
  };
}

function describeTarget(target: ActionTarget): string {
  if (target.identifier) {
    return target.identifier;
  }
  if (target.coordinate) {
    return `coordinate(${target.coordinate.x}, ${target.coordinate.y})`;
  }
  if (target.predicate) {
    return `predicate("${target.predicate}")`;
  }
  return 'unknown target';
}

function matchPredicate(elem: ElementSnapshot, predicate: string): boolean {
  // Simple XCUI predicate evaluation for common expressions:
  // e.g. "label == 'Save'", "label CONTAINS 'Total'", "identifier == '...'"
  const equalsMatch = predicate.match(/([a-zA-Z0-9_]+)\s*==\s*['"]([^'"]+)['"]/);
  if (equalsMatch) {
    const [, property, value] = equalsMatch;
    const elemProp = (elem as Record<string, unknown>)[property];
    return String(elemProp) === value;
  }

  const containsMatch = predicate.match(/([a-zA-Z0-9_]+)\s+CONTAINS(?:\[c\])?\s+['"]([^'"]+)['"]/i);
  if (containsMatch) {
    const [, property, value] = containsMatch;
    const elemProp = (elem as Record<string, unknown>)[property];
    if (typeof elemProp === 'string') {
      return elemProp.toLowerCase().includes(value.toLowerCase());
    }
  }

  return false;
}

function findElement(elements: ElementSnapshot[], target: ActionTarget): ElementSnapshot | undefined {
  if (target.type === 'accessibility') {
    if (target.identifier) {
      const match = elements.find((el) => el.identifier === target.identifier);
      if (match) return match;
    }
    // Fallback: match by label if identifier was omitted or specified
    if (target.identifier) {
      const labelMatch = elements.find((el) => el.label === target.identifier);
      if (labelMatch) return labelMatch;
    }
    return undefined;
  }

  if (target.type === 'coordinate' && target.coordinate) {
    const { x, y } = target.coordinate;
    // Find all elements containing the coordinate
    const matching = elements.filter(
      (el) =>
        x >= el.frame.x &&
        x <= el.frame.x + el.frame.width &&
        y >= el.frame.y &&
        y <= el.frame.y + el.frame.height
    );

    if (matching.length === 0) return undefined;
    // Return innermost element (smallest area)
    matching.sort((a, b) => a.frame.width * a.frame.height - b.frame.width * b.frame.height);
    return matching[0];
  }

  if (target.type === 'predicate' && target.predicate) {
    return elements.find((el) => matchPredicate(el, target.predicate!));
  }

  // Fallback: if identifier exists
  if (target.identifier) {
    return elements.find((el) => el.identifier === target.identifier);
  }

  return undefined;
}

/**
 * Evaluates a StateAssertion against a captured StateSnapshot.
 * Returns an array of StateDefect objects describing any detected discrepancies.
 */
export function evaluateStateAssertion(
  snapshot: StateSnapshot,
  assertion: StateAssertion
): StateDefect[] {
  const defects: StateDefect[] = [];

  // 1. Route check
  if (assertion.expectedRoute !== undefined) {
    if (snapshot.route !== assertion.expectedRoute) {
      defects.push({
        stepId: snapshot.stepId,
        category: 'ROUTE_MISMATCH',
        expected: assertion.expectedRoute,
        actual: snapshot.route ?? 'undefined',
        message: `Route mismatch at step '${snapshot.stepId}': expected '${assertion.expectedRoute}', got '${snapshot.route ?? 'undefined'}'`,
      });
    }
  }

  // 2. Keyboard visibility check
  if (assertion.keyboardVisible !== undefined) {
    if (snapshot.keyboardVisible !== assertion.keyboardVisible) {
      defects.push({
        stepId: snapshot.stepId,
        category: 'STATE_MISMATCH',
        expected: `keyboardVisible=${assertion.keyboardVisible}`,
        actual: `keyboardVisible=${snapshot.keyboardVisible}`,
        message: `Keyboard visibility mismatch at step '${snapshot.stepId}': expected ${assertion.keyboardVisible}, got ${snapshot.keyboardVisible}`,
      });
    }
  }

  // 3. Elements exist assertions
  if (assertion.elementsExist && assertion.elementsExist.length > 0) {
    for (const elemAssertion of assertion.elementsExist) {
      const target = elemAssertion.target;
      const matched = findElement(snapshot.elements, target);

      if (!matched) {
        defects.push({
          stepId: snapshot.stepId,
          category: 'ELEMENT_MISSING',
          targetIdentifier: target.identifier,
          expected: target.identifier ?? describeTarget(target),
          actual: 'missing',
          message: `Required element '${target.identifier ?? describeTarget(target)}' was not found in snapshot for step '${snapshot.stepId}'`,
        });
        continue;
      }

      // Check enabled
      if (elemAssertion.enabled !== undefined && matched.isEnabled !== elemAssertion.enabled) {
        defects.push({
          stepId: snapshot.stepId,
          category: 'STATE_MISMATCH',
          targetIdentifier: matched.identifier ?? target.identifier,
          expected: `isEnabled=${elemAssertion.enabled}`,
          actual: `isEnabled=${matched.isEnabled}`,
          message: `Element '${matched.identifier ?? target.identifier}' enabled mismatch at step '${snapshot.stepId}': expected ${elemAssertion.enabled}, got ${matched.isEnabled}`,
        });
      }

      // Check textEquals
      if (elemAssertion.textEquals !== undefined) {
        const matchesLabel = matched.label === elemAssertion.textEquals;
        const matchesValue = matched.value === elemAssertion.textEquals;
        if (!matchesLabel && !matchesValue) {
          defects.push({
            stepId: snapshot.stepId,
            category: 'STATE_MISMATCH',
            targetIdentifier: matched.identifier ?? target.identifier,
            expected: elemAssertion.textEquals,
            actual: matched.value ?? matched.label ?? '',
            message: `Element '${matched.identifier ?? target.identifier}' text mismatch at step '${snapshot.stepId}': expected textEquals '${elemAssertion.textEquals}', got label='${matched.label ?? ''}', value='${matched.value ?? ''}'`,
          });
        }
      }

      // Check textContains
      if (elemAssertion.textContains !== undefined) {
        const labelContains = Boolean(matched.label && matched.label.includes(elemAssertion.textContains));
        const valueContains = Boolean(matched.value && matched.value.includes(elemAssertion.textContains));
        if (!labelContains && !valueContains) {
          defects.push({
            stepId: snapshot.stepId,
            category: 'STATE_MISMATCH',
            targetIdentifier: matched.identifier ?? target.identifier,
            expected: `contains '${elemAssertion.textContains}'`,
            actual: matched.value ?? matched.label ?? '',
            message: `Element '${matched.identifier ?? target.identifier}' text mismatch at step '${snapshot.stepId}': expected to contain '${elemAssertion.textContains}', got label='${matched.label ?? ''}', value='${matched.value ?? ''}'`,
          });
        }
      }
    }
  }

  // 4. Elements not exist assertions
  if (assertion.elementsNotExist && assertion.elementsNotExist.length > 0) {
    for (const target of assertion.elementsNotExist) {
      const matched = findElement(snapshot.elements, target);
      if (matched) {
        defects.push({
          stepId: snapshot.stepId,
          category: 'STATE_MISMATCH',
          targetIdentifier: matched.identifier ?? target.identifier,
          expected: `Element '${target.identifier ?? describeTarget(target)}' to not exist`,
          actual: 'element_present',
          message: `Element '${target.identifier ?? describeTarget(target)}' was expected not to exist, but was found in snapshot for step '${snapshot.stepId}'`,
        });
      }
    }
  }

  return defects;
}
