// 参数定义与输入校验：非法输入一次性返回全部字段问题，不做“逐个报错”
export interface Params {
  totalX: number; // X 总步数 1..400
  totalY: number; // Y 总步数 1..400
  gapX: number; // X 冷却间隔 0..8
  gapY: number; // Y 冷却间隔 0..8
  tolerance: number; // 偏差上限 非负整数
}

export type ParamKey = keyof Params;
export type FieldErrors = Partial<Record<ParamKey, string>>;

export const PARAM_LABEL: Record<ParamKey, string> = {
  totalX: 'X 总步数',
  totalY: 'Y 总步数',
  gapX: 'X 冷却间隔',
  gapY: 'Y 冷却间隔',
  tolerance: '偏差上限',
};

export const PARAM_FIELDS: ParamKey[] = ['totalX', 'totalY', 'gapX', 'gapY', 'tolerance'];

const INT_RE = /^\s*(\d+)\s*$/;

function parseField(raw: string): { ok: true; value: number } | { ok: false } {
  const m = INT_RE.exec(raw ?? '');
  if (!m) return { ok: false };
  return { ok: true, value: Number(m[1]) };
}

/**
 * 校验五个参数字段。所有字段独立检查，问题一次性全部返回。
 * raw 使用字符串以精确拒绝 1.5 / -1 / 1e3 / 空值 / 含空格的非数字等。
 */
export function validateParams(raw: Record<ParamKey, string>): { value: Params | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const out: Record<ParamKey, number | null> = {
    totalX: null,
    totalY: null,
    gapX: null,
    gapY: null,
    tolerance: null,
  };

  const checkRange = (key: ParamKey, min: number, max: number) => {
    const r = parseField(raw[key]);
    if (!r.ok) {
      errors[key] = `${PARAM_LABEL[key]}必须是整数（当前值：${raw[key] === '' ? '空' : raw[key]}）`;
      return;
    }
    if (r.value < min || r.value > max) {
      errors[key] = `${PARAM_LABEL[key]}必须在 ${min} 至 ${max} 之间（当前值：${r.value}）`;
      return;
    }
    out[key] = r.value;
  };

  checkRange('totalX', 1, 400);
  checkRange('totalY', 1, 400);
  checkRange('gapX', 0, 8);
  checkRange('gapY', 0, 8);
  checkRange('tolerance', 0, Number.MAX_SAFE_INTEGER);

  if (Object.keys(errors).length > 0) return { value: null, errors };
  return {
    value: {
      totalX: out.totalX as number,
      totalY: out.totalY as number,
      gapX: out.gapX as number,
      gapY: out.gapY as number,
      tolerance: out.tolerance as number,
    },
    errors: {},
  };
}

export function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
