import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateStateAssertion,
  inferRoute,
  type StateSnapshot,
  type ElementSnapshot,
} from '../../../src/flow/state-snapshot.ts';

function expect<T>(actual: T) {
  return {
    toBe(expected: any) {
      assert.strictEqual(actual, expected);
    },
    toEqual(expected: any) {
      assert.deepStrictEqual(actual, expected);
    },
    toBeDefined() {
      assert.notStrictEqual(actual, undefined);
    },
    toHaveLength(expected: number) {
      assert.strictEqual((actual as any)?.length, expected);
    },
    toContain(item: any) {
      assert.ok((actual as any)?.includes(item));
    },
    toBeTruthy() {
      assert.ok(actual);
    },
    toBeFalsy() {
      assert.ok(!actual);
    },
  };
}

describe('StateSnapshot Evaluation & Route Inference', () => {
  const sampleSnapshot: StateSnapshot = {
    stepId: 'step-2',
    timestamp: '2026-09-19T10:00:00Z',
    screenshotPath: '/tmp/step-2.png',
    route: 'detail',
    routeConfidence: 'exact_identifier',
    keyboardVisible: false,
    elements: [
      {
        identifier: 'flow.button.save',
        elementType: 'Button',
        isEnabled: true,
        isHittable: true,
        frame: { x: 20, y: 100, width: 80, height: 44 },
      },
    ],
  };

  it('detects route mismatch defect', () => {
    const defects = evaluateStateAssertion(sampleSnapshot, {
      expectedRoute: 'settings',
    });
    expect(defects).toHaveLength(1);
    expect(defects[0].category).toBe('ROUTE_MISMATCH');
    expect(defects[0].expected).toBe('settings');
    expect(defects[0].actual).toBe('detail');
  });

  it('detects missing required element defect', () => {
    const defects = evaluateStateAssertion(sampleSnapshot, {
      elementsExist: [
        {
          target: { type: 'accessibility', identifier: 'flow.button.delete' },
        },
      ],
    });
    expect(defects).toHaveLength(1);
    expect(defects[0].category).toBe('ELEMENT_MISSING');
    expect(defects[0].targetIdentifier).toBe('flow.button.delete');
  });

  it('passes when all assertions are satisfied', () => {
    const defects = evaluateStateAssertion(sampleSnapshot, {
      expectedRoute: 'detail',
      keyboardVisible: false,
      elementsExist: [
        {
          target: { type: 'accessibility', identifier: 'flow.button.save' },
          enabled: true,
        },
      ],
    });
    expect(defects).toHaveLength(0);
  });

  it('detects keyboard visibility mismatch defect', () => {
    const defects = evaluateStateAssertion(sampleSnapshot, {
      keyboardVisible: true,
    });
    expect(defects).toHaveLength(1);
    expect(defects[0].category).toBe('STATE_MISMATCH');
    expect(defects[0].expected).toBe('keyboardVisible=true');
    expect(defects[0].actual).toBe('keyboardVisible=false');
  });

  it('detects element enabled state mismatch defect', () => {
    const defects = evaluateStateAssertion(sampleSnapshot, {
      elementsExist: [
        {
          target: { type: 'accessibility', identifier: 'flow.button.save' },
          enabled: false,
        },
      ],
    });
    expect(defects).toHaveLength(1);
    expect(defects[0].category).toBe('STATE_MISMATCH');
    expect(defects[0].targetIdentifier).toBe('flow.button.save');
    expect(defects[0].expected).toBe('isEnabled=false');
    expect(defects[0].actual).toBe('isEnabled=true');
  });

  it('detects element text mismatch with textEquals and textContains', () => {
    const snapshotWithText: StateSnapshot = {
      ...sampleSnapshot,
      elements: [
        {
          identifier: 'flow.field.title',
          label: 'Card Title',
          value: 'Grocery Shopping',
          elementType: 'TextField',
          isEnabled: true,
          isHittable: true,
          frame: { x: 20, y: 50, width: 200, height: 40 },
        },
      ],
    };

    const textEqualsMismatch = evaluateStateAssertion(snapshotWithText, {
      elementsExist: [
        {
          target: { type: 'accessibility', identifier: 'flow.field.title' },
          textEquals: 'Different Title',
        },
      ],
    });
    expect(textEqualsMismatch).toHaveLength(1);
    expect(textEqualsMismatch[0].category).toBe('STATE_MISMATCH');

    const textContainsMismatch = evaluateStateAssertion(snapshotWithText, {
      elementsExist: [
        {
          target: { type: 'accessibility', identifier: 'flow.field.title' },
          textContains: 'Electronics',
        },
      ],
    });
    expect(textContainsMismatch).toHaveLength(1);
    expect(textContainsMismatch[0].category).toBe('STATE_MISMATCH');

    const textMatches = evaluateStateAssertion(snapshotWithText, {
      elementsExist: [
        {
          target: { type: 'accessibility', identifier: 'flow.field.title' },
          textEquals: 'Grocery Shopping',
          textContains: 'Grocery',
        },
      ],
    });
    expect(textMatches).toHaveLength(0);
  });

  it('detects unwanted existing elements using elementsNotExist', () => {
    const defects = evaluateStateAssertion(sampleSnapshot, {
      elementsNotExist: [
        { type: 'accessibility', identifier: 'flow.button.save' },
      ],
    });
    expect(defects).toHaveLength(1);
    expect(defects[0].category).toBe('STATE_MISMATCH');
    expect(defects[0].targetIdentifier).toBe('flow.button.save');
  });

  it('evaluates coordinate-based target matching correctly', () => {
    const defects = evaluateStateAssertion(sampleSnapshot, {
      elementsExist: [
        {
          target: {
            type: 'coordinate',
            coordinate: { x: 50, y: 120 }, // Inside { x: 20, y: 100, width: 80, height: 44 }
          },
        },
      ],
    });
    expect(defects).toHaveLength(0);

    const outsideDefects = evaluateStateAssertion(sampleSnapshot, {
      elementsExist: [
        {
          target: {
            type: 'coordinate',
            coordinate: { x: 300, y: 500 },
          },
        },
      ],
    });
    expect(outsideDefects).toHaveLength(1);
    expect(outsideDefects[0].category).toBe('ELEMENT_MISSING');
  });

  describe('Route Three-tier Inference', () => {
    it('Tier 1: infers route from flow.screen.<name> root identifier', () => {
      const elements: ElementSnapshot[] = [
        {
          identifier: 'flow.screen.settings',
          elementType: 'Other',
          isEnabled: true,
          isHittable: true,
          frame: { x: 0, y: 0, width: 393, height: 852 },
        },
        {
          identifier: 'flow.button.back',
          elementType: 'Button',
          isEnabled: true,
          isHittable: true,
          frame: { x: 16, y: 50, width: 44, height: 44 },
        },
      ];

      const inference = inferRoute(elements);
      expect(inference.route).toBe('settings');
      expect(inference.routeConfidence).toBe('exact_identifier');
    });

    it('Tier 2: infers route from navigation bar title and title mapping', () => {
      const elements: ElementSnapshot[] = [
        {
          elementType: 'NavigationBar',
          label: 'Transaction Details',
          isEnabled: true,
          isHittable: true,
          frame: { x: 0, y: 44, width: 393, height: 44 },
        },
      ];

      const inference = inferRoute(elements, {
        titleToRouteMap: {
          'Transaction Details': 'transaction_detail',
        },
      });
      expect(inference.route).toBe('transaction_detail');
      expect(inference.routeConfidence).toBe('nav_title_inferred');
    });

    it('Tier 2: infers route from navigation bar title using knownScreens', () => {
      const elements: ElementSnapshot[] = [
        {
          elementType: 'NavigationBar',
          label: 'Card Settings',
          isEnabled: true,
          isHittable: true,
          frame: { x: 0, y: 44, width: 393, height: 44 },
        },
      ];

      const inference = inferRoute(elements, {
        knownScreens: [
          { id: 'screen-settings', name: 'Card Settings', route: 'card_settings' },
        ],
      });
      expect(inference.route).toBe('card_settings');
      expect(inference.routeConfidence).toBe('nav_title_inferred');
    });

    it('Tier 3: falls back to bootstrap assumed route when no root screen or nav title is found', () => {
      const elements: ElementSnapshot[] = [
        {
          identifier: 'flow.field.search',
          elementType: 'TextField',
          isEnabled: true,
          isHittable: true,
          frame: { x: 16, y: 100, width: 300, height: 40 },
        },
      ];

      const inference = inferRoute(elements, {
        bootstrapRoute: 'home',
      });
      expect(inference.route).toBe('home');
      expect(inference.routeConfidence).toBe('bootstrap_assumed');
    });

    it('returns undefined route with bootstrap_assumed confidence when no match occurs', () => {
      const elements: ElementSnapshot[] = [
        {
          identifier: 'flow.element.unknown',
          elementType: 'Other',
          isEnabled: true,
          isHittable: true,
          frame: { x: 0, y: 0, width: 100, height: 100 },
        },
      ];

      const inference = inferRoute(elements);
      expect(inference.route).toBe(undefined);
      expect(inference.routeConfidence).toBe('bootstrap_assumed');
    });
  });
});
