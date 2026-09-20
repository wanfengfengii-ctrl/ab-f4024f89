// 动作：双轴(Both)、仅 X、仅 Y、等待(Wait)
// 字典序固定为 双轴 < X < Y < 等待（综合搜索的选优次序）
export const ACTION_ORDER = ['B', 'X', 'Y', 'W'] as const;
export type ProgramChar = (typeof ACTION_ORDER)[number];

export function isProgramChar(s: string): s is ProgramChar {
  return s === 'B' || s === 'X' || s === 'Y' || s === 'W';
}

export const ACTION_NAME: Record<ProgramChar, string> = {
  B: '双轴',
  X: 'X 脉冲',
  Y: 'Y 脉冲',
  W: '等待',
};

// 动作在每个轴上的脉冲增量
export const DELTA: Record<ProgramChar, { dx: 0 | 1; dy: 0 | 1 }> = {
  B: { dx: 1, dy: 1 },
  X: { dx: 1, dy: 0 },
  Y: { dx: 0, dy: 1 },
  W: { dx: 0, dy: 0 },
};

export interface PrefixState {
  /** 时隙序号，0 为初始前缀 */
  slot: number;
  /** 该时隙发出的动作，slot=0 时为 null */
  action: ProgramChar | null;
  /** 该时隙后 X 累计步数 */
  x: number;
  /** 该时隙后 Y 累计步数 */
  y: number;
  /** 该时隙后偏差 = 总Y*x - 总X*y */
  deviation: number;
  /** 该时隙后 X 轴仍需隔开的“不含 X 时隙”数 */
  cooldownX: number;
  /** 该时隙后 Y 轴仍需隔开的“不含 Y 时隙”数 */
  cooldownY: number;
}
