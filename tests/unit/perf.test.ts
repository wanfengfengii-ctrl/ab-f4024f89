import { it } from 'vitest';
import { solve } from '../../src/core/scheduler';
import { replay } from '../../src/core/replay';

it.each([
  { totalX: 400, totalY: 400, gapX: 8, gapY: 8, tolerance: 400 * 400, label: 'worst-full-band' },
  { totalX: 400, totalY: 399, gapX: 8, gapY: 8, tolerance: 400, label: 'tight-gcd' },
  { totalX: 400, totalY: 400, gapX: 0, gapY: 0, tolerance: 1, label: 'tight-diag' },
  { totalX: 1, totalY: 1, gapX: 0, gapY: 0, tolerance: 0, label: 'min' },
])('perf $label', (p) => {
  const mb = process.memoryUsage().heapUsed;
  const t = Date.now();
  const r = solve(p as any);
  const dt = Date.now() - t;
  if (r.kind === 'feasible') {
    const chk = replay(r.program, p as any);
    console.log(
      `[${p.label}] slots=${r.totalSlots} waits=${r.waitSlots} states=${r.diagnostics.exploredStates} time=${dt}ms heapΔMB=${((process.memoryUsage().heapUsed - mb) / 1048576).toFixed(1)} replay=${chk.ok}`,
    );
  } else {
    console.log(`[${p.label}] INFEASIBLE time=${dt}ms ${r.reason.slice(0, 80)}`);
  }
}, 120000);
