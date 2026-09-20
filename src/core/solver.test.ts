import { describe, expect, it } from 'vitest';
import { solve, simulate } from './solver';
import { validateInput, earlyUnsatReason } from './validation';
import { ACTION_ORDER, ACTION_STEP, type Action, type PlannerInput } from './types';

/**
 * 独立深度优先验证器（与 BFS 实现风格刻意不同：递归 + 记忆化）。
 * 返回在「恰好 exactSlots 个时隙」内按动作字典序找到的第一个解，找不到返回 null。
 * 用 (状态id, 深度) 记忆化：DFS 严格按 ACTION_ORDER 扩展，
 * 同一 (状态, 深度) 的首次到达必来自字典序最小的前缀，故剪枝不影响结论。
 */
function lexicographicallyFirstWithin(
  input: PlannerInput,
  exactSlots: number,
): Action[] | null {
  const { totalX: X, totalY: Y, cooldownX: CX, cooldownY: CY, tolerance: T } =
    input;
  const dimY = Y + 1;
  const dimGX = CX + 1;
  const dimGY = CY + 1;
  const encode = (x: number, y: number, gx: number, gy: number) =>
    ((x * dimY + y) * dimGX + gx) * dimGY + gy;

  const dead = new Set<number>(); // 已确认在剩余预算内无法到终点的 (id,depth)
  const path: Action[] = [];

  const dfs = (x: number, y: number, gx: number, gy: number, depth: number): boolean => {
    if (x === X && y === Y) return true;
    if (depth >= exactSlots) return false;
    if (depth + Math.max(X - x, Y - y) > exactSlots) return false;

    const key = encode(x, y, gx, gy) * (exactSlots + 1) + depth;
    if (dead.has(key)) return false;

    for (const action of ACTION_ORDER) {
      const sx = ACTION_STEP[action].x;
      const sy = ACTION_STEP[action].y;
      if (sx === 1 && gx < CX) continue;
      if (sy === 1 && gy < CY) continue;
      const nx = x + sx;
      const ny = y + sy;
      if (nx > X || ny > Y) continue;
      const dev = Y * nx - X * ny;
      if (dev > T || dev < -T) continue;
      const ngx = sx === 1 ? 0 : Math.min(gx + 1, CX);
      const ngy = sy === 1 ? 0 : Math.min(gy + 1, CY);
      path.push(action);
      if (dfs(nx, ny, ngx, ngy, depth + 1)) return true;
      path.pop();
    }
    dead.add(key);
    return false;
  };

  return dfs(0, 0, CX, CY, 0) ? path.slice() : null;
}

/**
 * 工程上常见的「压缩单轴节拍」贪心：每个时隙优先发脉冲，
 * 脉冲数相同时优先单发、再按偏差、最后按动作序；只有全被走廊挡住才等待。
 */
function singlePulseFirstGreedy(input: PlannerInput): Action[] | null {
  const { totalX: X, totalY: Y, cooldownX: CX, cooldownY: CY, tolerance: T } =
    input;
  const seen = new Set<number>();
  let x = 0, y = 0, gx = CX, gy = CY;
  const program: Action[] = [];

  while (!(x === X && y === Y)) {
    const key = ((x * (Y + 1) + y) * (CX + 1) + gx) * (CY + 1) + gy;
    if (seen.has(key)) return null; // 贪心陷入循环
    seen.add(key);

    const legal: { action: Action; idx: number; nx: number; ny: number; pulses: number; dev: number }[] = [];
    ACTION_ORDER.forEach((action, idx) => {
      const sx = ACTION_STEP[action].x;
      const sy = ACTION_STEP[action].y;
      if (sx === 1 && gx < CX) return;
      if (sy === 1 && gy < CY) return;
      const nx = x + sx;
      const ny = y + sy;
      if (nx > X || ny > Y) return;
      const dev = Y * nx - X * ny;
      if (dev > T || dev < -T) return;
      legal.push({ action, idx, nx, ny, pulses: sx + sy, dev });
    });
    if (legal.length === 0) return null;

    const withPulse = legal.filter((o) => o.pulses > 0);
    const pool = withPulse.length > 0 ? withPulse : legal;
    pool.sort((a, b) => a.pulses - b.pulses || Math.abs(a.dev) - Math.abs(b.dev) || a.idx - b.idx);
    const pick = pool[0];
    program.push(pick.action);
    x = pick.nx;
    y = pick.ny;
    gx = ACTION_STEP[pick.action].x === 1 ? 0 : Math.min(gx + 1, CX);
    gy = ACTION_STEP[pick.action].y === 1 ? 0 : Math.min(gy + 1, CY);
  }
  return program;
}

/**
 * 另一种逐时隙贪心：永远选择使该时隙后 |偏差| 最小的动作。
 */
function minDeviationGreedy(input: PlannerInput): Action[] | null {
  const { totalX: X, totalY: Y, cooldownX: CX, cooldownY: CY, tolerance: T } =
    input;
  const seen = new Set<number>();
  let x = 0, y = 0, gx = CX, gy = CY;
  const program: Action[] = [];

  while (!(x === X && y === Y)) {
    const key = ((x * (Y + 1) + y) * (CX + 1) + gx) * (CY + 1) + gy;
    if (seen.has(key)) return null;
    seen.add(key);

    const legal: { action: Action; idx: number; nx: number; ny: number; dev: number }[] = [];
    ACTION_ORDER.forEach((action, idx) => {
      const sx = ACTION_STEP[action].x;
      const sy = ACTION_STEP[action].y;
      if (sx === 1 && gx < CX) return;
      if (sy === 1 && gy < CY) return;
      const nx = x + sx;
      const ny = y + sy;
      if (nx > X || ny > Y) return;
      const dev = Y * nx - X * ny;
      if (dev > T || dev < -T) return;
      legal.push({ action, idx, nx, ny, dev });
    });
    if (legal.length === 0) return null;

    legal.sort((a, b) => Math.abs(a.dev) - Math.abs(b.dev) || a.idx - b.idx);
    const pick = legal[0];
    program.push(pick.action);
    x = pick.nx;
    y = pick.ny;
    gx = ACTION_STEP[pick.action].x === 1 ? 0 : Math.min(gx + 1, CX);
    gy = ACTION_STEP[pick.action].y === 1 ? 0 : Math.min(gy + 1, CY);
  }
  return program;
}

describe('validateInput —— 一次标出全部问题', () => {
  it('合法输入通过', () => {
    const r = validateInput({
      totalX: '8', totalY: '5', cooldownX: '2', cooldownY: '0', tolerance: '3',
    });
    expect(r.errors).toEqual([]);
    expect(r.value).toEqual({ totalX: 8, totalY: 5, cooldownX: 2, cooldownY: 0, tolerance: 3 });
  });

  it('空值、非整数、越界同时出现时全部报告', () => {
    const r = validateInput({
      totalX: '',
      totalY: '1.5',
      cooldownX: '9',
      cooldownY: '-1',
      tolerance: 'abc',
    });
    expect(r.errors).toHaveLength(5);
    expect(r.errors.map((e) => e.field)).toEqual([
      'totalX', 'totalY', 'cooldownX', 'cooldownY', 'tolerance',
    ]);
    expect(r.value).toBeNull();
  });

  it('步数边界：0 与 401 非法，1 与 400 合法；冷却 0~8', () => {
    const bad = validateInput({ totalX: '0', totalY: '401', cooldownX: '0', cooldownY: '8', tolerance: '0' });
    expect(bad.errors.map((e) => e.field)).toEqual(['totalX', 'totalY']);
    const ok = validateInput({ totalX: '1', totalY: '400', cooldownX: '8', cooldownY: '0', tolerance: '999999999' });
    expect(ok.errors).toEqual([]);
  });
});

describe('solve —— 冷却与走廊的手工用例', () => {
  it('无冷却大偏差：单时隙双轴即可', () => {
    const r = solve({ totalX: 1, totalY: 1, cooldownX: 0, cooldownY: 0, tolerance: 100 });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.actions).toEqual(['XY']);
    expect(simulate(r.input, r.actions).violations).toEqual([]);
  });

  it('X 冷却 1：XY、等待、X', () => {
    const r = solve({ totalX: 2, totalY: 1, cooldownX: 1, cooldownY: 0, tolerance: 1000 });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.actions).toEqual(['XY', 'WAIT', 'X']);
    expect(simulate(r.input, r.actions).violations).toEqual([]);
  });

  it('两轴冷却均为 1：双轴脉冲之间必须等待，3 时隙', () => {
    const r = solve({ totalX: 2, totalY: 2, cooldownX: 1, cooldownY: 1, tolerance: 1000 });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.actions).toEqual(['XY', 'WAIT', 'XY']);
  });

  it('两轴冷却均为 1、各 3 步：XY、等待、XY、等待、XY', () => {
    const r = solve({ totalX: 3, totalY: 3, cooldownX: 1, cooldownY: 1, tolerance: 1000 });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.actions).toEqual(['XY', 'WAIT', 'XY', 'WAIT', 'XY']);
  });

  it('冷却 8、总步数 400：脉冲之间恰好 8 个等待', () => {
    const r = solve({ totalX: 400, totalY: 400, cooldownX: 8, cooldownY: 8, tolerance: 10 ** 12 });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.actions).toHaveLength(400 + 399 * 8);
    expect(r.actions[0]).toBe('XY');
    expect(r.actions.slice(1, 9)).toEqual(Array(8).fill('WAIT'));
    expect(simulate(r.input, r.actions).violations).toEqual([]);
  });

  it('偏差上限 0 且总步数相等：沿对角线走双轴', () => {
    const r = solve({ totalX: 3, totalY: 3, cooldownX: 0, cooldownY: 0, tolerance: 0 });
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.actions).toEqual(['XY', 'XY', 'XY']);
    r.slots.forEach((s) => expect(s.absDeviation).toBe(0));
  });

  it('第一步即越界：给出明确无解原因且不进行搜索', () => {
    // X=6,Y=2,T=1：发 X 偏差 2、发 Y 偏差 6、双轴偏差 4，第一步无合法选择
    const input: PlannerInput = { totalX: 6, totalY: 2, cooldownX: 0, cooldownY: 0, tolerance: 1 };
    expect(earlyUnsatReason(input)).not.toBeNull();
    const r = solve(input);
    expect(r.kind).toBe('unsat');
    if (r.kind === 'ok') return;
    expect(r.reason).toContain('越界');
    expect(r.stats.visited).toBe(0);
  });

  it('起步合法但走廊中途封闭：完整搜索穷尽后报告最远位置', () => {
    // X=1,Y=4,T=1：第一步 Y 合法（偏差 -1），但 (0,1) 的任何脉冲后继都越界
    const r = solve({ totalX: 1, totalY: 4, cooldownX: 0, cooldownY: 0, tolerance: 1 });
    expect(r.kind).toBe('unsat');
    if (r.kind === 'ok') return;
    expect(earlyUnsatReason({ totalX: 1, totalY: 4, cooldownX: 0, cooldownY: 0, tolerance: 1 })).toBeNull();
    expect(r.reason).toContain('穷尽');
    expect(r.reason).toContain('(0, 1)');
  });
});

describe('solve —— 小规模独立 DFS 对拍：最短性 + 字典序 + 可解性', () => {
  it('全部实例与递归验证器一致；程序逐时隙复算零违规', () => {
    let cases = 0;
    let solvable = 0;
    for (let X = 1; X <= 7; X++) {
      for (let Y = 1; Y <= 7; Y++) {
        for (let cx = 0; cx <= 3; cx++) {
          for (let cy = 0; cy <= 3; cy++) {
            for (let T = 0; T <= Math.max(X, Y); T++) {
              const input = { totalX: X, totalY: Y, cooldownX: cx, cooldownY: cy, tolerance: T };
              cases++;
              const r = solve(input);
              if (r.kind === 'unsat') {
                // 独立验证器在宽松预算内也找不到解
                expect(lexicographicallyFirstWithin(input, 60)).toBeNull();
                continue;
              }
              solvable++;
              // 长度减一时隙必无解 => BFS 结果确为最短
              expect(lexicographicallyFirstWithin(input, r.actions.length - 1)).toBeNull();
              // 恰好该长度时字典序第一个解必须与 BFS 程序完全一致
              expect(lexicographicallyFirstWithin(input, r.actions.length)).toEqual(r.actions);
              const sim = simulate(input, r.actions);
              expect(sim.violations).toEqual([]);
              expect(sim.finalX).toBe(X);
              expect(sim.finalY).toBe(Y);
            }
          }
        }
      }
    }
    expect(solvable).toBeGreaterThan(2500);
    expect(cases).toBeGreaterThan(4500);
  });
});

describe('逐时隙贪心的风险（需求明示完整搜索不可由贪心替代）', () => {
  it('「压缩单轴节拍 / 单发优先」贪心得到非最短程序：1,1 时 X、Y 共 2 时隙，最优为双轴 1 时隙', () => {
    const input: PlannerInput = { totalX: 1, totalY: 1, cooldownX: 0, cooldownY: 0, tolerance: 1 };
    const r = solve(input);
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    const greedy = singlePulseFirstGreedy(input);
    expect(greedy).toEqual(['X', 'Y']);
    expect(greedy!.length).toBeGreaterThan(r.actions.length);
    expect(r.actions).toEqual(['XY']);
  });

  it('「最小偏差」贪心会在起点无限等待：X=1,Y=2,T=1 有解但贪心失败', () => {
    const input: PlannerInput = { totalX: 1, totalY: 2, cooldownX: 0, cooldownY: 0, tolerance: 1 };
    const r = solve(input);
    expect(r.kind).toBe('ok');
    expect(minDeviationGreedy(input)).toBeNull(); // WAIT 保持偏差 0，形成循环
    if (r.kind === 'ok') expect(simulate(input, r.actions).violations).toEqual([]);
  });

  it('穷举小规模空间：两种贪心都不会优于完整搜索，且各有严格失败实例', () => {
    let singleLonger = 0;
    let minDevFails = 0;
    for (let X = 1; X <= 8; X++) {
      for (let Y = 1; Y <= 8; Y++) {
        for (const [cx, cy] of [[0, 0], [0, 2], [2, 0], [2, 2]] as const) {
          for (let T = 0; T <= Math.max(X, Y); T++) {
            const input = { totalX: X, totalY: Y, cooldownX: cx, cooldownY: cy, tolerance: T };
            const r = solve(input);
            if (r.kind !== 'ok') continue;
            const g1 = singlePulseFirstGreedy(input);
            if (g1 === null || g1.length > r.actions.length) singleLonger++;
            else expect(g1.length).toBeGreaterThanOrEqual(r.actions.length);
            const g2 = minDeviationGreedy(input);
            if (g2 === null || g2.length > r.actions.length) minDevFails++;
            else expect(g2.length).toBeGreaterThanOrEqual(r.actions.length);
          }
        }
      }
    }
    expect(singleLonger).toBeGreaterThan(0);
    expect(minDevFails).toBeGreaterThan(0);
  });
});

describe('simulate —— 独立复算能识别违规程序', () => {
  it('冷却违规、总量不符全部报出', () => {
    const bad: Action[] = ['X', 'X', 'Y'];
    const sim = simulate({ totalX: 3, totalY: 2, cooldownX: 2, cooldownY: 0, tolerance: 5 }, bad);
    expect(sim.violations.join(' ')).toContain('冷却');
    expect(sim.violations.join(' ')).toContain('不一致');
  });

  it('偏差越界逐时隙报出', () => {
    const bad: Action[] = ['X'];
    const sim = simulate({ totalX: 3, totalY: 3, cooldownX: 0, cooldownY: 0, tolerance: 0 }, bad);
    expect(sim.violations.join(' ')).toContain('偏差');
  });
});
