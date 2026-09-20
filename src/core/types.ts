/** 业务领域类型定义（纯类型，无 DOM 依赖） */

/** 单个时隙可下发的动作 */
export type Action = 'XY' | 'X' | 'Y' | 'WAIT';

/** 字典序比较的动作次序：双轴 < X < Y < 等待 */
export const ACTION_ORDER: readonly Action[] = ['XY', 'X', 'Y', 'WAIT'] as const;

/** 动作在该时隙是否推动各轴 */
export const ACTION_STEP: Readonly<Record<Action, { x: 0 | 1; y: 0 | 1 }>> = {
  XY: { x: 1, y: 1 },
  X: { x: 1, y: 0 },
  Y: { x: 0, y: 1 },
  WAIT: { x: 0, y: 0 },
};

export const ACTION_LABEL: Readonly<Record<Action, string>> = {
  XY: '双轴',
  X: 'X',
  Y: 'Y',
  WAIT: '等待',
};

/** 规划输入 */
export interface PlannerInput {
  /** X 轴总步数 */
  totalX: number;
  /** Y 轴总步数 */
  totalY: number;
  /** X 轴冷却间隔：相邻两个含 X 脉冲时隙之间至少隔开的不含 X 时隙数（0~8） */
  cooldownX: number;
  /** Y 轴冷却间隔（0~8） */
  cooldownY: number;
  /** 偏差上限（非负整数）：|Y总·已走X − X总·已走Y| ≤ 上限 */
  tolerance: number;
}

/** 单个时隙的复算快照 */
export interface StepSnapshot {
  /** 时隙序号，从 1 开始 */
  slot: number;
  action: Action;
  /** 该时隙之后累计的 X 步数 */
  xAfter: number;
  /** 该时隙之后累计的 Y 步数 */
  yAfter: number;
  /** 偏差 = Y总·已走X − X总·已走Y */
  deviation: number;
  /** 偏差绝对值 */
  absDeviation: number;
  /** 下发前 X 轴已经等待的不含 X 时隙数（供冷却复核） */
  xGapBefore: number;
  /** 下发前 Y 轴已经等待的不含 Y 时隙数 */
  yGapBefore: number;
}

/** 成功搜索结果 */
export interface ProgramResult {
  kind: 'ok';
  input: PlannerInput;
  actions: Action[];
  slots: StepSnapshot[];
  /** 搜索过程统计 */
  stats: {
    visited: number;
    enqueued: number;
    elapsedMs: number;
  };
}

/** 无解结果 */
export interface UnsatResult {
  kind: 'unsat';
  input: PlannerInput;
  reason: string;
  stats: {
    visited: number;
    enqueued: number;
    elapsedMs: number;
  };
}

export type SolveResult = ProgramResult | UnsatResult;

/** 导出 JSON 的文件格式 */
export interface ExportedProgram {
  format: 'dual-axis-pulse-program/v1';
  generatedAt: string;
  input: PlannerInput;
  result: {
    solvable: boolean;
    reason?: string;
    totalSlots: number;
    actions: Action[];
    timeline: StepSnapshot[];
    stats: ProgramResult['stats'];
  };
}
