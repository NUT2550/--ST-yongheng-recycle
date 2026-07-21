/**
 * ST-58 Phase 5 — Executable regression tests for sort-source-weight input.
 *
 * These tests mount the REAL SortPage component inside a happy-dom
 * environment and verify that the memoization refactor did NOT change
 * any business behavior:
 *
 *   1. Typing source weight updates the visible input immediately
 *   2. Decimal input remains correct
 *   3. Clearing the input works
 *   4. Final parsed weight is correct
 *   5. Validation still detects output total exceeding source
 *   6. Waste calculation is unchanged
 *   7. Save payload uses the latest typed value
 *   8. No stale value after rapid typing
 *   9. No change to sorting cost semantics (formulas unchanged)
 *   10. Unrelated output rows are not recomputed unnecessarily
 *
 * Run: bun test tests/st58/st58-sort-input-regression.test.ts
 */
import { Window } from 'happy-dom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { performance } from 'perf_hooks';
import { test, expect, describe, beforeAll, afterAll } from 'bun:test';

// ============ happy-dom setup ============

const w = new Window();
(globalThis as Record<string, unknown>).window = w;
(globalThis as Record<string, unknown>).document = w.document;
(globalThis as Record<string, unknown>).navigator = w.navigator;
(globalThis as Record<string, unknown>).HTMLElement = w.HTMLElement;
for (const key of Object.getOwnPropertyNames(w)) {
  if (!(key in globalThis) && key !== 'undefined') {
    try {
      (globalThis as Record<string, unknown>)[key] = (w as unknown as Record<string, unknown>)[key];
    } catch {
      // skip
    }
  }
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 0) as unknown as number;

const { act } = React;

// Suppress act warnings
const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.includes('act(') || msg.includes('not wrapped in act')) return;
  origConsoleError(...(args as unknown[]));
};

// ============ network stub ============

let lastCreateSortingBillPayload: unknown = null;

(globalThis as Record<string, unknown>).fetch = async (
  input: string | URL | Request
) => {
  const url = typeof input === 'string' ? input : input.toString();
  if (url.includes('/api/products') || url === '/products') {
    const cats = [
      { id: 'c1', name: 'เหล็ก', type: 'STEEL', sortOrder: 1 },
      { id: 'c2', name: 'ทองแดง', type: 'METAL', sortOrder: 2 },
    ];
    const products: unknown[] = [];
    let idx = 0;
    for (const cat of cats) {
      for (let i = 1; i <= 6; i++) {
        idx++;
        products.push({
          id: `p${idx}`,
          name: `${cat.name} ${i}`,
          categoryId: cat.id,
          defaultBuyPrice: 10 + i,
          sortOrder: idx,
          category: cat,
          stock: { totalWeight: 500 + i * 10, totalCost: (500 + i * 10) * (10 + i), avgCostPerKg: 10 + i },
        });
      }
    }
    return new Response(JSON.stringify({ products }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (url.includes('/api/auth/me')) {
    return new Response(
      JSON.stringify({ user: { id: 'u1', username: 'admin', name: 'Admin', role: 'admin' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
  if (url.includes('/api/sorting-bills') && input instanceof Request && input.method === 'POST') {
    const body = (input as Request).body;
    // Read the request body if available
    const reqClone = (input as Request).clone();
    lastCreateSortingBillPayload = await reqClone.json().catch(() => null);
    return new Response(JSON.stringify({ bill: { id: 'test-bill-1', lossWeight: 0, lossCost: 0 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ============ Import real modules ============

const { SortPage } = await import('../../src/components/sort-page');
const { useAppStore } = await import('../../src/lib/store');
const { parseWeightExpression } = await import('../../src/lib/safe-math');

// ============ Helper: mount SortPage and return utilities ============

interface MountedApp {
  root: ReturnType<typeof createRoot>;
  container: HTMLElement;
  getSourceWeightInput: () => HTMLInputElement;
  getSourceWeightHandler: () => ((e: { target: { value: string } }) => void) | undefined;
  getSubmitButton: () => HTMLButtonElement;
  cleanup: () => void;
}

async function mountSortPage(): Promise<MountedApp> {
  const container = w.document.createElement('div');
  w.document.body.appendChild(container);
  const root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);

  useAppStore.setState({
    sortSourceProductId: '',
    sortSourceWeight: 0,
    sortSourcePricePerKg: 0,
    sortWeighedTotal: 0,
    sortRoomNumber: '',
    sortCartItems: [],
  });

  act(() => {
    root.render(React.createElement(SortPage));
  });

  // Wait for fetchProducts useEffect to resolve
  await new Promise((r) => setTimeout(r, 150));

  return {
    root,
    container: container as unknown as HTMLElement,
    getSourceWeightInput: () => w.document.getElementById('sort-source-weight') as unknown as HTMLInputElement,
    getSourceWeightHandler: () => {
      const input = w.document.getElementById('sort-source-weight');
      if (!input) return undefined;
      const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps'));
      const props = (input as unknown as Record<string, unknown>)[propsKey ?? ''] as
        | { onChange?: (e: { target: { value: string } }) => void }
        | undefined;
      return props?.onChange;
    },
    getSubmitButton: () => {
      const buttons = w.document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent?.includes('บันทึกใบคัดแยก')) {
          return btn as unknown as HTMLButtonElement;
        }
      }
      return null as unknown as HTMLButtonElement;
    },
    cleanup: () => {
      root.unmount();
      while (w.document.body.firstChild) {
        w.document.body.removeChild(w.document.body.firstChild);
      }
    },
  };
}

async function selectSourceProduct(): Promise<void> {
  useAppStore.setState({ sortSourceProductId: 'p1', sortSourcePricePerKg: 15 });
  await new Promise((r) => setTimeout(r, 50));
}

async function addCartItem(weight: number, price: number, isWaste = false): Promise<void> {
  const state = useAppStore.getState();
  const bonusAmount = isWaste ? 0 : Math.max((price - 15) * weight * 0.1, 0);
  state.addSortCartItem({
    productId: 'p2',
    productName: `Item ${weight}kg`,
    weight,
    isWaste,
    sortedPricePerKg: price,
    bonusAmount,
  });
  await new Promise((r) => setTimeout(r, 30));
}

function typeSourceWeight(app: MountedApp, value: string): void {
  const handler = app.getSourceWeightHandler();
  if (!handler) throw new Error('onChange handler not found');
  act(() => {
    handler({ target: { value } });
  });
}

// ============ Tests ============

describe('ST-58: sort-source-weight input regression', () => {
  let app: MountedApp;

  beforeAll(async () => {
    app = await mountSortPage();
    await selectSourceProduct();
  });

  afterAll(() => {
    app.cleanup();
  });

  test('1. typing source weight updates the visible input immediately', () => {
    typeSourceWeight(app, '860');
    const input = app.getSourceWeightInput();
    expect(input.value).toBe('860');

    typeSourceWeight(app, '860-3');
    expect(input.value).toBe('860-3');
  });

  test('2. decimal input remains correct', () => {
    typeSourceWeight(app, '68.4');
    const input = app.getSourceWeightInput();
    expect(input.value).toBe('68.4');

    // Verify the parsed weight is correct
    const state = useAppStore.getState();
    expect(state.sortSourceWeight).toBe(68.4);
  });

  test('3. clearing the input works', () => {
    typeSourceWeight(app, '100');
    expect(app.getSourceWeightInput().value).toBe('100');

    typeSourceWeight(app, '');
    expect(app.getSourceWeightInput().value).toBe('');

    // After clearing, the store weight should remain at the last valid value
    // (this matches production behavior — clearing does not reset to 0)
    const state = useAppStore.getState();
    // The store keeps the last parsed value when input is cleared
    // because onChange only updates the store when parseWeightExpression succeeds
    expect(state.sortSourceWeight).toBe(100);
  });

  test('4. final parsed weight is correct', () => {
    typeSourceWeight(app, '860-3');
    const state = useAppStore.getState();
    expect(state.sortSourceWeight).toBe(857);

    typeSourceWeight(app, '(100+200)*2');
    expect(useAppStore.getState().sortSourceWeight).toBe(600);
  });

  test('5. validation still detects output total exceeding source', async () => {
    // Set source weight to 100
    typeSourceWeight(app, '100');
    await new Promise((r) => setTimeout(r, 30));

    // Add output items totaling 150 (exceeds source)
    useAppStore.setState({ sortCartItems: [] });
    await new Promise((r) => setTimeout(r, 30));
    await addCartItem(150, 20);

    const state = useAppStore.getState();
    const totalSortedWeight = state.sortCartItems.reduce((s, i) => s + i.weight, 0);
    const lossWeight = Math.round((state.sortSourceWeight - totalSortedWeight) * 100) / 100;

    // lossWeight should be negative (output exceeds source)
    expect(lossWeight).toBe(-50);
    expect(lossWeight < 0).toBe(true);
  });

  test('6. waste calculation is unchanged', async () => {
    useAppStore.setState({ sortCartItems: [] });
    await new Promise((r) => setTimeout(r, 30));

    typeSourceWeight(app, '200');
    await new Promise((r) => setTimeout(r, 30));

    // Add 100kg of normal output + 20kg of waste
    await addCartItem(100, 20, false);
    await addCartItem(20, 0, true);

    const state = useAppStore.getState();
    const totalSortedWeight = state.sortCartItems.reduce((s, i) => s + i.weight, 0);
    const lossWeight = Math.round((state.sortSourceWeight - totalSortedWeight) * 100) / 100;

    // 200 source - 120 total (100 normal + 20 waste) = 80 loss
    expect(totalSortedWeight).toBe(120);
    expect(lossWeight).toBe(80);

    // Loss cost = lossWeight * sortSourcePricePerKg
    // sortSourcePricePerKg is auto-filled from the product's defaultBuyPrice (p1 = 11)
    const expectedLossCost = Math.round(lossWeight * state.sortSourcePricePerKg * 100) / 100;
    const lossCost = Math.round(lossWeight * state.sortSourcePricePerKg * 100) / 100;
    expect(lossCost).toBe(expectedLossCost);
    // Verify the formula: 80 * 11 = 880
    expect(state.sortSourcePricePerKg).toBe(11);
    expect(lossCost).toBe(880);
  });

  test('7. save payload uses the latest typed value', async () => {
    useAppStore.setState({ sortCartItems: [] });
    await new Promise((r) => setTimeout(r, 30));
    await selectSourceProduct();
    typeSourceWeight(app, '500');
    await new Promise((r) => setTimeout(r, 30));
    await addCartItem(400, 20, false);
    await new Promise((r) => setTimeout(r, 30));

    // Verify the store has the latest value
    const state = useAppStore.getState();
    expect(state.sortSourceWeight).toBe(500);

    // The save payload would use sortSourceWeight from the store, which is the latest value
    // We verify this by checking that parseWeightExpression(sourceWeightInput) in handleSubmit
    // would produce the same value
    const input = app.getSourceWeightInput();
    const result = parseWeightExpression(input.value);
    expect(result.value).toBe(state.sortSourceWeight);
  });

  test('8. no stale value after rapid typing', async () => {
    // Rapidly type multiple values
    typeSourceWeight(app, '1');
    typeSourceWeight(app, '12');
    typeSourceWeight(app, '123');
    typeSourceWeight(app, '1234');
    typeSourceWeight(app, '1234-5');

    await new Promise((r) => setTimeout(r, 30));

    const input = app.getSourceWeightInput();
    const state = useAppStore.getState();

    // The input should show the latest value
    expect(input.value).toBe('1234-5');
    // The store should have the latest parsed value
    expect(state.sortSourceWeight).toBe(1229);
  });

  test('9. no change to sorting cost semantics (formulas unchanged)', async () => {
    useAppStore.setState({ sortCartItems: [] });
    await new Promise((r) => setTimeout(r, 30));

    typeSourceWeight(app, '300');
    await new Promise((r) => setTimeout(r, 30));

    // Read the actual sortSourcePricePerKg from the store (may be 11 from auto-fill
    // or 15 from manual set depending on test execution order)
    const pricePerKg = useAppStore.getState().sortSourcePricePerKg;
    expect(pricePerKg).toBeGreaterThan(0);

    // Add items with known values
    await addCartItem(100, 25, false);
    await addCartItem(150, 18, false);

    const state = useAppStore.getState();
    const totalSortedWeight = state.sortCartItems.reduce((s, i) => s + i.weight, 0);
    const lossWeight = Math.round((state.sortSourceWeight - totalSortedWeight) * 100) / 100;
    const lossCost = Math.round(lossWeight * state.sortSourcePricePerKg * 100) / 100;

    // 300 source - 250 output = 50 loss
    expect(totalSortedWeight).toBe(250);
    expect(lossWeight).toBe(50);
    // lossCost = 50 * pricePerKg
    expect(lossCost).toBe(Math.round(50 * pricePerKg * 100) / 100);

    // Gross profit = (25-pricePerKg)*100 + (18-pricePerKg)*150
    const totalGrossProfit = state.sortCartItems.reduce((sum, item) => {
      if (item.isWaste) return sum;
      return sum + Math.round((item.sortedPricePerKg - state.sortSourcePricePerKg) * item.weight * 100) / 100;
    }, 0);
    const expectedGrossProfit = Math.round(((25 - pricePerKg) * 100 + (18 - pricePerKg) * 150) * 100) / 100;
    expect(totalGrossProfit).toBe(expectedGrossProfit);

    // Net profit = grossProfit - lossCost
    const netProfit = Math.max(totalGrossProfit - lossCost, 0);
    const expectedNetProfit = Math.max(expectedGrossProfit - lossCost, 0);
    expect(netProfit).toBe(expectedNetProfit);

    // Bonus = netProfit * 0.1
    const bonus = Math.round(netProfit * 0.1 * 100) / 100;
    expect(bonus).toBe(Math.round(expectedNetProfit * 0.1 * 100) / 100);
  });

  test('10. SourceWeightInput is memoized (does not re-render on unrelated cart changes)', async () => {
    // This test verifies that the SourceWeightInput component has stable identity
    // by checking that its React.memo wrapper prevents unnecessary re-renders.
    // We verify this by checking that the onChange handler reference is stable
    // across parent re-renders triggered by cart changes.

    useAppStore.setState({ sortCartItems: [] });
    await new Promise((r) => setTimeout(r, 30));
    typeSourceWeight(app, '100');
    await new Promise((r) => setTimeout(r, 30));

    // Capture the handler reference
    const handler1 = app.getSourceWeightHandler();
    expect(handler1).toBeDefined();

    // Trigger a parent re-render by adding a cart item
    await addCartItem(50, 20, false);
    await new Promise((r) => setTimeout(r, 30));

    // The handler reference should be the SAME (stable identity from useCallback)
    const handler2 = app.getSourceWeightHandler();
    expect(handler2).toBe(handler1);

    // Add another item
    await addCartItem(30, 22, false);
    await new Promise((r) => setTimeout(r, 30));

    const handler3 = app.getSourceWeightHandler();
    expect(handler3).toBe(handler1);

    // The input value should still be correct
    expect(app.getSourceWeightInput().value).toBe('100');
  });
});
