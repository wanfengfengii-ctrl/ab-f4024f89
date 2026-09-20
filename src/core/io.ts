import { Params, ParamKey, PARAM_FIELDS, validateParams } from './validation';
import { ProgramChar, isProgramChar } from './types';
import { replay } from './replay';

export interface ExportDoc {
  app: 'dual-axis-pulse-planner';
  version: 1;
  exportedAt: string;
  params: Params;
  program: string;
  stats: {
    totalSlots: number;
    pulseSlots: number;
    waitSlots: number;
  };
}

export interface ImportResult {
  ok: boolean;
  /** 一次性收集的全部问题 */
  errors: string[];
  doc?: { params: Params; program: ProgramChar[] };
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

/**
 * 导入并复核：字段问题一次性全部列出；
 * 程序必须通过同一套逐时隙复算（冷却/走廊/终态），否则拒绝导入。
 */
export function importDoc(text: string): ImportResult {
  const errors: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`JSON 解析失败：${(e as Error).message}`] };
  }
  if (typeof raw !== 'object' || raw === null) {
    return { ok: false, errors: ['导入内容必须是 JSON 对象'] };
  }
  const obj = raw as Record<string, unknown>;

  if (obj.app !== undefined && obj.app !== 'dual-axis-pulse-planner') {
    errors.push(`app 字段应为 "dual-axis-pulse-planner"，实际为 ${JSON.stringify(obj.app)}`);
  }

  const rawParams = obj.params;
  let params: Params | null = null;
  if (typeof rawParams !== 'object' || rawParams === null) {
    errors.push('缺少 params 对象（须含 totalX,totalY,gapX,gapY,tolerance）');
  } else {
    const po = rawParams as Record<string, unknown>;
    const rawStrings = {} as Record<ParamKey, string>;
    for (const key of PARAM_FIELDS) {
      const v = po[key];
      if (!isInt(v)) {
        errors.push(`params.${key} 必须是整数，实际为 ${JSON.stringify(v)}`);
        rawStrings[key] = '';
      } else {
        rawStrings[key] = String(v);
      }
    }
    if (errors.length === 0 || PARAM_FIELDS.every((k) => isInt((po as Record<string, unknown>)[k]))) {
      const v = validateParams(rawStrings);
      if (!v.value) {
        for (const key of PARAM_FIELDS) {
          if (v.errors[key]) errors.push(v.errors[key]!);
        }
      } else {
        params = v.value;
      }
    }
  }

  let program: ProgramChar[] = [];
  if (typeof obj.program !== 'string') {
    errors.push('program 字段必须是字符串（仅含字符 B、X、Y、W）');
  } else {
    for (let i = 0; i < obj.program.length; i++) {
      const ch = obj.program[i];
      if (!isProgramChar(ch)) {
        errors.push(`program 第 ${i + 1} 个字符 "${ch}" 非法，只允许 B / X / Y / W`);
      } else {
        program.push(ch);
      }
    }
    if (program.length === 0) errors.push('program 为空程序，无法到达任何非零目标');
  }

  if (!params || program.length === 0 || errors.length > 0) {
    return { ok: false, errors };
  }

  const check = replay(program, params);
  if (!check.ok) {
    errors.push(`程序复算失败：${check.reason}`);
    return { ok: false, errors };
  }

  if (typeof obj.stats === 'object' && obj.stats !== null) {
    const st = obj.stats as Record<string, unknown>;
    let pulse = 0;
    for (const a of program) if (a !== 'W') pulse++;
    const expected = { totalSlots: program.length, pulseSlots: pulse, waitSlots: program.length - pulse };
    for (const k of ['totalSlots', 'pulseSlots', 'waitSlots'] as const) {
      if (k in st && st[k] !== expected[k]) {
        errors.push(`stats.${k} 与程序复算结果不符（记录 ${st[k]}，应为 ${expected[k]}）`);
      }
    }
    if (errors.length) return { ok: false, errors };
  }

  return { ok: true, errors: [], doc: { params, program } };
}
