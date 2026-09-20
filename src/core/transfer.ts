import { simulate } from './solver';
import type {
  Action,
  ExportedProgram,
  PlannerInput,
  ProgramResult,
  SolveResult,
} from './types';

/** 由「同一个程序对象」生成导出 JSON：动作、逐时隙时间线均来自同一次求解结果 */
export function buildExportedProgram(result: SolveResult): ExportedProgram {
  const base = {
    format: 'dual-axis-pulse-program/v1' as const,
    generatedAt: new Date().toISOString(),
    input: result.input,
  };
  if (result.kind === 'ok') {
    // 导出前再独立复算一次，确保 JSON 与表格/轨迹同源且逐时隙可复核
    const sim = simulate(result.input, result.actions);
    return {
      ...base,
      result: {
        solvable: true,
        totalSlots: result.actions.length,
        actions: [...result.actions],
        timeline: sim.snapshots,
        stats: result.stats,
      },
    };
  }
  return {
    ...base,
    result: {
      solvable: false,
      reason: result.reason,
      totalSlots: 0,
      actions: [],
      timeline: [],
      stats: result.stats,
    },
  };
}

export interface ImportCheck {
  ok: boolean;
  input?: PlannerInput;
  actions?: Action[];
  errors: string[];
}

/** 解析并校验导入的 JSON 文件（结构、范围、动作字、冷却与走廊复算） */
export function parseImportedProgram(text: string): ImportCheck {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['文件不是合法 JSON'] };
  }

  const obj = raw as Partial<ExportedProgram>;
  if (!raw || typeof raw !== 'object' || obj.format !== 'dual-axis-pulse-program/v1') {
    errors.push('格式标识缺失或不支持（应为 dual-axis-pulse-program/v1）');
    return { ok: false, errors };
  }

  const i = obj.input as Partial<PlannerInput> | undefined;
  const r = obj.result as
    | { solvable?: boolean; actions?: unknown; reason?: string }
    | undefined;
  if (!i || !r) {
    errors.push('缺少 input 或 result 字段');
    return { ok: false, errors };
  }

  const intCheck = (v: unknown, label: string, min: number, max: number): number | null => {
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      errors.push(`${label}必须是整数`);
      return null;
    }
    if (v < min || v > max) {
      errors.push(`${label}必须在 ${min} 至 ${max} 之间`);
      return null;
    }
    return v;
  };

  const totalX = intCheck(i.totalX, 'X 轴总步数', 1, 400);
  const totalY = intCheck(i.totalY, 'Y 轴总步数', 1, 400);
  const cooldownX = intCheck(i.cooldownX, 'X 轴冷却间隔', 0, 8);
  const cooldownY = intCheck(i.cooldownY, 'Y 轴冷却间隔', 0, 8);
  const tol = intCheck(i.tolerance, '偏差上限', 0, Number.MAX_SAFE_INTEGER);

  if (errors.length > 0 || totalX === null || totalY === null ||
    cooldownX === null || cooldownY === null || tol === null) {
    return { ok: false, errors };
  }

  const input: PlannerInput = {
    totalX, totalY, cooldownX, cooldownY, tolerance: tol,
  };

  if (r.solvable === false) return { ok: true, input, errors };

  if (!Array.isArray(r.actions)) {
    errors.push('result.actions 必须是数组');
    return { ok: false, errors, input };
  }
  const validActions: Action[] = ['XY', 'X', 'Y', 'WAIT'];
  const actions: Action[] = [];
  r.actions.forEach((a, idx) => {
    if (typeof a !== 'string' || !validActions.includes(a as Action)) {
      errors.push(`第 ${idx + 1} 个动作非法：${JSON.stringify(a)}`);
    } else {
      actions.push(a as Action);
    }
  });
  if (errors.length > 0) return { ok: false, errors, input };

  // 对导入程序逐时隙独立复算
  const sim = simulate(input, actions);
  errors.push(...sim.violations);
  if (errors.length > 0) return { ok: false, errors, input, actions };

  return { ok: true, input, actions, errors: [] };
}

/** 供 UI 直接复算当前程序（与导出走同一函数族） */
export function reverifyProgram(result: ProgramResult): string[] {
  return simulate(result.input, result.actions).violations;
}
