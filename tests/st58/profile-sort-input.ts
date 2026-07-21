/**
 * ST-58 Phase 2/6 — Profiling harness for sort-source-weight input.
 *
 * Mounts the REAL SortPage component (from src/components/sort-page.tsx)
 * inside a happy-dom environment, extracts the production onChange handler
 * from React's fiber props, and measures per-keystroke render duration
 * via React.act()-wrapped handler invocations.
 *
 * Measurements are taken with varying cart sizes (0, 5, 20 items) to show
 * how the cart-list re-render scales.
 *
 * Run: bun run tests/st58/profile-sort-input.ts
 *
 * Output: printed to stdout. Results are NOT Production field data;
 * they are local happy-dom measurements on the developer machine.
 */
import { Window } from 'happy-dom';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { performance } from 'perf_hooks';

// ============ 1. Set up happy-dom globals ============

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
      // skip non-copyable
    }
  }
}
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 0) as unknown as number;

const { act } = React;

// Suppress act() warnings (expected in happy-dom without a full browser event loop)
const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  const msg = String(args[0] ?? '');
  if (msg.includes('act(') || msg.includes('not wrapped in act')) return;
  origConsoleError(...(args as unknown[]));
};

// ============ 2. Stub network ============

(globalThis as Record<string, unknown>).fetch = async (
  input: string | URL | Request
) => {
  const url = typeof input === 'string' ? input : input.toString();
  if (url.includes('/api/products') || url === '/products') {
    const cats = [
      { id: 'c1', name: 'เหล็ก', type: 'STEEL', sortOrder: 1 },
      { id: 'c2', name: 'ทองแดง', type: 'METAL', sortOrder: 2 },
      { id: 'c3', name: 'ทองเหลือง', type: 'METAL', sortOrder: 3 },
      { id: 'c4', name: 'อลูมิเนียม', type: 'METAL', sortOrder: 4 },
      { id: 'c5', name: 'สแตนเลส', type: 'METAL', sortOrder: 5 },
      { id: 'c6', name: 'ตะกั่ว', type: 'METAL', sortOrder: 6 },
      { id: 'c7', name: 'อิเล็กทรอนิกส์', type: 'METAL', sortOrder: 7 },
      { id: 'c8', name: 'พลาสติก', type: 'STEEL', sortOrder: 8 },
      { id: 'c9', name: 'อื่นๆ', type: 'STEEL', sortOrder: 9 },
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
  return new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// ============ 3. Import REAL SortPage ============

const { SortPage } = await import('../../src/components/sort-page');
const { useAppStore } = await import('../../src/lib/store');

// ============ 4. Profiling scenario ============

interface RunResult {
  cartSize: number;
  runs: number[][];
  medians: number[];
  maxMedian: number;
  overallMax: number;
}

async function profileWithCartSize(cartSize: number): Promise<RunResult> {
  const container = w.document.createElement('div');
  w.document.body.appendChild(container);
  const root = createRoot(container as unknown as Parameters<typeof createRoot>[0]);

  // Reset store
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

  // Wait for useEffect (fetchProducts) to resolve
  await new Promise((r) => setTimeout(r, 200));

  // Select source product + set price
  useAppStore.setState({ sortSourceProductId: 'p1', sortSourcePricePerKg: 15 });

  // Add cart items
  const state = useAppStore.getState();
  for (let i = 0; i < cartSize; i++) {
    state.addSortCartItem({
      productId: `p${i + 1}`,
      productName: `Product ${i + 1}`,
      weight: 50 + i,
      isWaste: i === cartSize - 1,
      sortedPricePerKg: i === cartSize - 1 ? 0 : 20 + i,
      bonusAmount:
        i === cartSize - 1 ? 0 : Math.max((20 + i - 15) * (50 + i) * 0.1, 0),
    });
  }

  await new Promise((r) => setTimeout(r, 100));

  const input = w.document.getElementById('sort-source-weight') as unknown as HTMLInputElement;
  if (!input) throw new Error('#sort-source-weight not found');

  // Extract onChange from React's fiber props
  const propsKey = Object.keys(input).find((k) => k.startsWith('__reactProps'));
  const props = (input as unknown as Record<string, unknown>)[propsKey ?? ''] as
    | { onChange?: (e: { target: { value: string } }) => void }
    | undefined;
  const handler = props?.onChange;
  if (!handler) throw new Error('onChange handler not found on input');

  const sequence = ['8', '86', '860', '860-', '860-3', '860-3.', '860-3.5'];
  const allRuns: number[][] = [];

  for (let run = 0; run < 5; run++) {
    const results: number[] = [];
    for (const val of sequence) {
      const start = performance.now();
      act(() => {
        handler({ target: { value: val } });
      });
      results.push(performance.now() - start);
    }
    allRuns.push(results);
  }

  const medians = sequence.map((_, i) => {
    const times = allRuns.map((r) => r[i]).sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
  });

  root.unmount();
  // Clean up DOM
  while (w.document.body.firstChild) {
    w.document.body.removeChild(w.document.body.firstChild);
  }

  return {
    cartSize,
    runs: allRuns,
    medians,
    maxMedian: Math.max(...medians),
    overallMax: Math.max(...allRuns.flat()),
  };
}

function printResult(label: string, r: RunResult): void {
  console.log(`\n=== ${label} ===`);
  console.log(`  cart size: ${r.cartSize}`);
  for (let i = 0; i < r.runs.length; i++) {
    console.log(
      `  run ${i + 1}: ${r.runs[i].map((t) => t.toFixed(2)).join(', ')}`
    );
  }
  console.log(`  medians: ${r.medians.map((t) => t.toFixed(2)).join(', ')} ms`);
  console.log(`  max median: ${r.maxMedian.toFixed(2)} ms`);
  console.log(`  overall max: ${r.overallMax.toFixed(2)} ms`);
}

// ============ 5. Run profiles ============

console.log('ST-58 Phase 2/6 — sort-source-weight profiling');
console.log('Environment: happy-dom + React 19 + REAL SortPage component');
console.log('Method: extract onChange from React fiber props, invoke via act()');
console.log('Scenario: type "8","86","860","860-","860-3","860-3.","860-3.5" (7 keystrokes, 5 runs each)');

const r0 = await profileWithCartSize(0);
printResult('PRODUCTION (0 cart items, 54 products)', r0);

const r5 = await profileWithCartSize(5);
printResult('PRODUCTION (5 cart items, 54 products)', r5);

const r20 = await profileWithCartSize(20);
printResult('PRODUCTION (20 cart items, 54 products)', r20);

console.log('\n=== SUMMARY (max median per keystroke) ===');
console.log(`  0 cart items:  ${r0.maxMedian.toFixed(2)} ms`);
console.log(`  5 cart items:  ${r5.maxMedian.toFixed(2)} ms`);
console.log(`  20 cart items: ${r20.maxMedian.toFixed(2)} ms`);

process.exit(0);
