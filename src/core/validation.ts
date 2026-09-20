import type { PlannerInput } from './types';

/** 单个字段的校验错误 */
export interface FieldError {
  field: keyof PlannerInput;
  message: string;
}

/**
 * 一次标出输入中的全部问题。
 * 输入以字符串形式给出（来自文本框），同时覆盖：缺失、非整数、越界。
 */
export function validateInput(raw: Record<keyof PlannerInput, string>): {
  value: PlannerInput | null;
  errors: FieldError[];
} {
  const errors: FieldError[] = [];

  const parseInt10 = (text: string, field: keyof PlannerInput, label: string,
    min: number, max: number): number | null => {
    const t = text.trim();
    if (t === '') {
      errors.push({ field, message: `${label}不能为空` });
      return null;
    }
    if (!/^[+-]?\d+$/.test(t)) {
      errors.push({ field, message: `${label}必须是整数` });
      return null;
    }
    const n = Number(t);
    if (!Number.isSafeInteger(n)) {
      errors.push({ field, message: `${label}超出安全整数范围` });
      return null;
    }
    if (n < min || n > max) {
      errors.push({ field, message: `${label}必须在 ${min} 至 ${max} 之间` });
      return null;
    }
    return n;
  };

  const totalX = parseInt10(raw.totalX, 'totalX', 'X 轴总步数', 1, 400);
  const totalY = parseInt10(raw.totalY, 'totalY', 'Y 轴总步数', 1, 400);
  const cooldownX = parseInt10(raw.cooldownX, 'cooldownX', 'X 轴冷却间隔', 0, 8);
  const cooldownY = parseInt10(raw.cooldownY, 'cooldownY', 'Y 轴冷却间隔', 0, 8);
  const tolerance = parseInt10(raw.tolerance, 'tolerance', '偏差上限', 0, Number.MAX_SAFE_INTEGER);

  if (errors.length > 0) return { value: null, errors };

  return {
    value: {
      totalX: totalX as number,
      totalY: totalY as number,
      cooldownX: cooldownX as number,
      cooldownY: cooldownY as number,
      tolerance: tolerance as number,
    },
    errors: [],
  };
}

/**
 * 走廊可行性的快速必要条件，用于在完整搜索前给出明确的无解原因。
 * 注意：这只是“早知道”的诊断，最终仍由 BFS 穷举判定可解性。
 */
export function earlyUnsatReason(input: PlannerInput): string | null {
  const { totalX, totalY, tolerance } = input;
  // 第一个脉冲之后（前缀长度 1）：
  //   先 X：偏差 |Y总|；先 Y：偏差 |X总|；双轴：|Y总 − X总|
  // 三者都必须存在合法选择，否则任何程序的第一步即越界。
  const firstStepPossible =
    totalY <= tolerance || totalX <= tolerance || Math.abs(totalY - totalX) <= tolerance;
  if (!firstStepPossible) {
    return `第一步脉冲必然越界：发 X 偏差为 ${totalY}，发 Y 偏差为 ${totalX}，双轴偏差为 ${Math.abs(totalY - totalX)}，均大于上限 ${tolerance}`;
  }
  return null;
}
