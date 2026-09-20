import { DELTA, PrefixState, ProgramChar, isProgramChar } from './types';
import { Params } from './validation';

export interface ReplayResult {
  ok: boolean;
  reason?: string;
  /** 首个违规时隙（从 1 起） */
  badSlot?: number;
  states: PrefixState[];
}

/**
 * 按给定参数逐时隙复算程序：
 *  - 冷却：相邻两个含同一轴脉冲的时隙之间，至少隔开该轴 gap 个“不含该轴”时隙
 *  - 走廊：每个非初始前缀 |Y总*已走X - X总*已走Y| <= tolerance
 *  - 终态：恰好到达 (totalX, totalY)，不超发
 * 任何违规都给出发生时隙与原因。
 */
export function replay(program: ProgramChar[], p: Params): ReplayResult {
  const states: PrefixState[] = [
    { slot: 0, action: null, x: 0, y: 0, deviation: 0, cooldownX: 0, cooldownY: 0 },
  ];
  let x = 0;
  let y = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < program.length; i++) {
    const a = program[i];
    const slot = i + 1;
    const { dx, dy } = DELTA[a];

    if (dx && cx > 0) {
      return {
        ok: false,
        badSlot: slot,
        reason: `时隙 ${slot} 发出 X 脉冲时，X 仍处于冷却（还需间隔 ${cx} 个不含 X 的时隙，X 冷却间隔为 ${p.gapX}）`,
        states,
      };
    }
    if (dy && cy > 0) {
      return {
        ok: false,
        badSlot: slot,
        reason: `时隙 ${slot} 发出 Y 脉冲时，Y 仍处于冷却（还需间隔 ${cy} 个不含 Y 的时隙，Y 冷却间隔为 ${p.gapY}）`,
        states,
      };
    }
    if (x + dx > p.totalX) {
      return { ok: false, badSlot: slot, reason: `时隙 ${slot} 使 X 步数 ${x + dx} 超过总步数 ${p.totalX}`, states };
    }
    if (y + dy > p.totalY) {
      return { ok: false, badSlot: slot, reason: `时隙 ${slot} 使 Y 步数 ${y + dy} 超过总步数 ${p.totalY}`, states };
    }

    x += dx;
    y += dy;
    cx = dx ? p.gapX : Math.max(0, cx - 1);
    cy = dy ? p.gapY : Math.max(0, cy - 1);
    const deviation = p.totalY * x - p.totalX * y;

    if (Math.abs(deviation) > p.tolerance) {
      return {
        ok: false,
        badSlot: slot,
        reason: `时隙 ${slot} 的非初始前缀偏差 |${p.totalY}×${x} − ${p.totalX}×${y}| = ${Math.abs(deviation)} 超过上限 ${p.tolerance}`,
        states,
      };
    }
    states.push({ slot, action: a, x, y, deviation, cooldownX: cx, cooldownY: cy });
  }

  if (x !== p.totalX || y !== p.totalY) {
    return {
      ok: false,
      reason: `程序结束时坐标 (${x}, ${y}) 未到达目标 (${p.totalX}, ${p.totalY})`,
      states,
    };
  }
  return { ok: true, states };
}

/** 仅做词法解析（供导入时给出精确错误位置） */
export function parseProgramString(s: string): ProgramChar[] | { badIndex: number; badChar: string } {
  const out: ProgramChar[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (!isProgramChar(ch)) return { badIndex: i, badChar: ch };
    out.push(ch);
  }
  return out;
}
