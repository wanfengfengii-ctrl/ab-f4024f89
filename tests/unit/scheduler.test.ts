import { describe, expect, it } from 'vitest';
import { validateParams } from '../../src/core/validation';
import { replay } from '../../src/core/replay';
import { solve } from '../../src/core/scheduler';
import { ACTION_ORDER, ProgramChar } from '../../src/core/types';
import { importDoc } from '../../src/core/io';

describe('validateParams 一次性标出全部问题', () => {
  it('收集所有非法字段', () => {
    const r = validateParams({
      totalX: '0',
      totalY: '401',
      gapX: '9',
      gapY: '-1',
      tolerance: '1.5',
    });
    expect(r.value).toBeNull();
    expect(Object.keys(r.errors).sort()).toEqual(['gapX', 'gapY', 'tolerance', 'totalX', 'totalY']);
  });

  it('拒绝空值/科学计数/带杂字符，接受合法边界值', () => {
    expect(validateParams({ totalX: '', totalY: '1', gapX: '0', gapY: '8', tolerance: '0' }).errors.totalX).toContain('整数');
    expect(validateParams({ totalX: '1e3', totalY: '1', gapX: '0', gapY: '0', tolerance: '0' }).errors.totalX).toBeTruthy();
    const ok = validateParams({ totalX: '400', totalY: '1', gapX: '8', gapY: '0', tolerance: '999999999' });
    expect(ok.value).toEqual({ totalX: 400, totalY: 1, gapX: 8, gapY: 0, tolerance: 999999999 });
  });
});

// ---- 暴力参考实现：前向 BFS，同层按 B<X<Y<W 扩展，首达即最短且字典序最小 ----
function bruteForce(p: { totalX: number; totalY: number; gapX: number; gapY: number; tolerance: number }): string | null {
  const { totalX: TX, totalY: TY, gapX: gx, gapY: gy, tolerance: tol } = p;
  const key = (x: number, y: number, cx: number, cy: number) => (((x * (TY + 1) + y) * 9 + cx) * 9 + cy);
  const start = key(0, 0, 0, 0);
  const seen = new Set<number>([start]);
  let layer: { k: number; prog: string }[] = [{ k: start, prog: '' }];
  while (layer.length) {
    const next: typeof layer = [];
    for (const node of layer) {
      let k = node.k;
      const cy = k % 9; k = (k - cy) / 9;
      const cx = k % 9; k = (k - cx) / 9;
      const y = k % (TY + 1);
      const x = (k - y) / (TY + 1);
      for (const a of ACTION_ORDER) {
        let nx = x, ny = y, ncx = cx, ncy = cy;
        if (a === 'B') { if (cx || cy || x >= TX || y >= TY) continue; nx++; ny++; ncx = gx; ncy = gy; }
        if (a === 'X') { if (cx || x >= TX) continue; nx++; ncx = gx; ncy = Math.max(0, cy - 1); }
        if (a === 'Y') { if (cy || y >= TY) continue; ny++; ncy = gy; ncx = Math.max(0, cx - 1); }
        if (a === 'W') { ncx = Math.max(0, cx - 1); ncy = Math.max(0, cy - 1); }
        if (Math.abs(TY * nx - TX * ny) > tol) continue;
        const nk = key(nx, ny, ncx, ncy);
        if (seen.has(nk)) continue;
        seen.add(nk);
        const np = node.prog + a;
        // 到达目标位置即结束（允许终态冷却非零；拖尾等待必非最短）
        if (nx === TX && ny === TY) return np;
        next.push({ k: nk, prog: np });
      }
    }
    layer = next;
  }
  return null;
}

describe('solve 与暴力实现穷举对拍', () => {
  const cases: { totalX: number; totalY: number; gapX: number; gapY: number; tolerance: number }[] = [];
  for (let TX = 1; TX <= 5; TX++)
    for (let TY = 1; TY <= 5; TY++)
      for (let gx = 0; gx <= 3; gx++)
        for (let gy = 0; gy <= 3; gy++)
          for (const tol of [0, 1, 2, 4, 8])
            cases.push({ totalX: TX, totalY: TY, gapX: gx, gapY: gy, tolerance: tol });

  it('全部 ' + cases.length + ' 个小实例：有解一致（长度+字典序），无解一致', () => {
    for (const p of cases) {
      const expected = bruteForce(p);
      const got = solve(p);
      if (expected === null) {
        expect(got.kind, JSON.stringify(p)).toBe('infeasible');
      } else {
        expect(got.kind, JSON.stringify(p)).toBe('feasible');
        if (got.kind !== 'feasible') continue;
        expect(got.program.join(''), JSON.stringify(p)).toBe(expected);
        expect(got.totalSlots, JSON.stringify(p)).toBe(expected.length);
        // 交付程序必须逐时隙复算通过
        const chk = replay(got.program, p);
        expect(chk.ok, `${JSON.stringify(p)} ${chk.reason}`).toBe(true);
        // 脉冲计数
        let pulse = 0;
        for (const a of got.program as ProgramChar[]) if (a !== 'W') pulse++;
        expect(got.pulseSlots).toBe(pulse);
        expect(got.waitSlots).toBe(expected.length - pulse);
      }
    }
  }, 300000);
});

describe('冷却间隔语义专项', () => {
  it('相邻 X 脉冲之间必须恰好插入至少 gapX 个不含 X 时隙', () => {
    // TX=3,TY=1, gx=2, gy=0, tol 足够大
    const p = { totalX: 3, totalY: 1, gapX: 2, gapY: 0, tolerance: 100 };
    const r = solve(p);
    expect(r.kind).toBe('feasible');
    if (r.kind !== 'feasible') return;
    const chk = replay(r.program, p);
    expect(chk.ok).toBe(true);
    // 手工核对：每个 X/B 之后的 2 个时隙内不得再出现 X/B
    const lastX: number[] = [];
    r.program.forEach((a, i) => {
      if (a === 'B' || a === 'X') {
        if (lastX.length) expect(i - lastX[lastX.length - 1] - 1).toBeGreaterThanOrEqual(2);
        lastX.push(i);
      }
    });
  });
});

describe('复算器对导入/编辑程序的精确拒绝', () => {
  it('冷却违规给出时隙', () => {
    const p = { totalX: 2, totalY: 1, gapX: 1, gapY: 0, tolerance: 100 };
    const r = replay(['X', 'X', 'Y'], p);
    expect(r.ok).toBe(false);
    expect(r.badSlot).toBe(2);
  });
  it('走廊违规给出时隙与数值', () => {
    const p = { totalX: 2, totalY: 1, gapX: 0, gapY: 0, tolerance: 0 };
    const r = replay(['X', 'X', 'Y'], p);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('超过上限');
  });
});

describe('importDoc 一次性报错且必须复算通过', () => {
  it('多个问题同时返回', () => {
    const r = importDoc('{"app":"x","params":{"totalX":0,"totalY":1,"gapX":0,"gapY":0,"tolerance":0},"program":"Z"}');
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });
  it('词法合法但违反冷却的程序被拒绝', () => {
    const doc = {
      app: 'dual-axis-pulse-planner',
      params: { totalX: 2, totalY: 1, gapX: 2, gapY: 0, tolerance: 100 },
      program: 'XXYW',
      stats: { totalSlots: 4, pulseSlots: 3, waitSlots: 1 },
    };
    const r = importDoc(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toContain('复算失败');
  });
  it('合法导出可重新导入', () => {
    const p = { totalX: 4, totalY: 3, gapX: 1, gapY: 1, tolerance: 2 };
    const s = solve(p);
    expect(s.kind).toBe('feasible');
    if (s.kind !== 'feasible') return;
    const doc = {
      app: 'dual-axis-pulse-planner',
      version: 1,
      params: p,
      program: s.program.join(''),
      stats: { totalSlots: s.totalSlots, pulseSlots: s.pulseSlots, waitSlots: s.waitSlots },
    };
    const r = importDoc(JSON.stringify(doc));
    expect(r.ok, r.errors.join(';')).toBe(true);
  });
});
