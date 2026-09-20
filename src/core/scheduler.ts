import { Params, gcd } from './validation';
import { ACTION_ORDER, ProgramChar } from './types';
import { replay } from './replay';

export interface Diagnostics {
  /** 后向 BFS 标记的状态数 */
  exploredStates: number;
  elapsedMs: number;
  /** BFS 到达的最大距离层（= 最小时隙数） */
  bfsDepth: number;
}

export type SolveOutcome =
  | {
      kind: 'feasible';
      program: ProgramChar[];
      totalSlots: number;
      pulseSlots: number;
      waitSlots: number;
      diagnostics: Diagnostics;
    }
  | {
      kind: 'infeasible';
      reason: string;
      nearest: { x: number; y: number };
      diagnostics: Diagnostics;
    };

// 冷却值编码基数（gap 最大 8，故 0..8）
const CD = 9;

function enc(x: number, y: number, cx: number, cy: number, w: number): number {
  return (((x * w + y) * CD + cx) * CD + cy);
}

function dec(k: number, w: number): { x: number; y: number; cx: number; cy: number } {
  const cy = k % CD;
  let t = (k - cy) / CD;
  const cx = t % CD;
  t = (t - cx) / CD;
  const y = t % w;
  const x = (t - y) / w;
  return { x, y, cx, cy };
}

/**
 * 位置级可达性预检（忽略冷却）：
 * 冷却约束只会额外插入等待，而等待不改变坐标与偏差，
 * 因此“能否在走廊内到达目标”只取决于 (totalX,totalY,tolerance)。
 * 状态最多 401*401 ≈ 16 万，穷举即可对无解给出确定结论与最远可达位置。
 */
function positionFeasibility(p: Params): { feasible: boolean; nearest: { x: number; y: number } } {
  const { totalX: TX, totalY: TY, tolerance: tol } = p;
  const w = TY + 1;
  const seen = new Uint8Array((TX + 1) * (TY + 1));
  seen[0] = 1;
  let frontier = [0];
  let nearest = { x: 0, y: 0 };
  const inBand = (x: number, y: number) => Math.abs(TY * x - TX * y) <= tol;

  while (frontier.length) {
    const next: number[] = [];
    for (const cell of frontier) {
      const y = cell % w;
      const x = (cell - y) / w;
      if (x + y > nearest.x + nearest.y) nearest = { x, y };
      // B
      if (x < TX && y < TY) {
        const nx = x + 1;
        const ny = y + 1;
        const nk = nx * w + ny;
        if (!seen[nk] && inBand(nx, ny)) {
          seen[nk] = 1;
          next.push(nk);
        }
      }
      // X
      if (x < TX) {
        const nx = x + 1;
        const nk = nx * w + y;
        if (!seen[nk] && inBand(nx, y)) {
          seen[nk] = 1;
          next.push(nk);
        }
      }
      // Y
      if (y < TY) {
        const ny = y + 1;
        const nk = x * w + ny;
        if (!seen[nk] && inBand(x, ny)) {
          seen[nk] = 1;
          next.push(nk);
        }
      }
    }
    frontier = next;
  }

  return { feasible: seen[TX * w + TY] === 1, nearest };
}

/** 前向合法后继（走廊/边界/冷却），返回编码与动作 */
function forwardSucc(
  s: { x: number; y: number; cx: number; cy: number },
  a: ProgramChar,
  p: Params,
  w: number,
): number | null {
  const { totalX: TX, totalY: TY, gapX: gx, gapY: gy, tolerance: tol } = p;
  let { x, y, cx, cy } = s;
  if (a === 'B') {
    if (cx !== 0 || cy !== 0 || x >= TX || y >= TY) return null;
    x += 1;
    y += 1;
    cx = gx;
    cy = gy;
  } else if (a === 'X') {
    if (cx !== 0 || x >= TX) return null;
    x += 1;
    cx = gx;
    cy = Math.max(0, cy - 1);
  } else if (a === 'Y') {
    if (cy !== 0 || y >= TY) return null;
    y += 1;
    cy = gy;
    cx = Math.max(0, cx - 1);
  } else {
    cx = Math.max(0, cx - 1);
    cy = Math.max(0, cy - 1);
  }
  if (Math.abs(TY * x - TX * y) > tol) return null;
  return enc(x, y, cx, cy, w);
}

/**
 * 综合主程序：
 * 1) 位置级预检快速、确定地识别无解；
 * 2) 后向 BFS（目标→起点）计算每个冷却状态到目标的最短时隙距离；
 *    状态 = (x,y,cx,cy)，有限且至多约 1300 万，距离表稠密存放；
 * 3) 沿最短路径 DAG 按 双轴<X<Y<等待 做深度优先提取，
 *    第一个到达目标的程序即“时隙最短且字典序最小”的唯一答案。
 */
export function solve(p: Params): SolveOutcome {
  const t0 = performance.now();
  const { totalX: TX, totalY: TY, gapX: gx, gapY: gy, tolerance: tol } = p;

  const pre = positionFeasibility(p);
  if (!pre.feasible) {
    const g = gcd(TY, TX);
    const reason =
      `无解：偏差走廊（上限 ${tol}）过窄，在只考虑坐标（忽略冷却）时已无法从 (0,0) 到达 (${TX},${TY})，` +
      `加入冷却等待只会更长，不可能出现可行程序。可达位置最远为 (${pre.nearest.x},${pre.nearest.y})` +
      `（还差 X ${TX - pre.nearest.x} 步、Y ${TY - pre.nearest.y} 步）。` +
      (tol < g
        ? `任意非零线点偏差都是 ${g}（gcd(${TY},${TX})）的倍数，而 ${tol} < ${g}，请增大偏差上限。`
        : `所有偏差均为 ${g}（gcd(${TY},${TX})）的倍数，请增大偏差上限后重试。`);
    return {
      kind: 'infeasible',
      reason,
      nearest: pre.nearest,
      diagnostics: { exploredStates: 0, elapsedMs: performance.now() - t0, bfsDepth: 0 },
    };
  }

  const w = TY + 1;
  const maxKey = enc(TX, TY, gx, gy, w);
  // dist[k] = 该状态到“到达目标位置”的最短时隙数；-1 表示尚未发现
  const dist = new Int32Array(maxKey + 1).fill(-1);
  const startKey = 0; // enc(0,0,0,0)

  // 终态集合：坐标到达 (TX,TY) 时程序立即结束，允许冷却计数器非零
  // （任何拖尾等待都会平白增加时隙，必不在最短程序中；且终态偏差恒为 0，必在走廊内）
  const targetKeys: number[] = [];
  for (let cx = 0; cx <= gx; cx++) {
    for (let cy = 0; cy <= gy; cy++) {
      const k = enc(TX, TY, cx, cy, w);
      dist[k] = 0;
      targetKeys.push(k);
    }
  }
  let frontier: number[] = targetKeys;
  let depth = 0;
  let explored = targetKeys.length;
  let found = dist[startKey] === 0;

  const inBand = (x: number, y: number) => Math.abs(TY * x - TX * y) <= tol;

  // 枚举全部前向直接前驱（逆向转移），保证前驱集合精确、无遗漏、无重复
  const pushPred = (qk: number, next: number[]) => {
    if (dist[qk] === -1) {
      dist[qk] = depth + 1;
      explored++;
      next.push(qk);
      if (qk === startKey) found = true;
    }
  };

  outer: while (frontier.length && !found) {
    const next: number[] = [];
    for (const key of frontier) {
      const s = dec(key, w);
      const { x, y, cx, cy } = s;

      // B 的前驱：发射前两轴冷却均为 0，发射后 cx=gx, cy=gy
      if (x >= 1 && y >= 1 && cx === gx && cy === gy) {
        const qx = x - 1;
        const qy = y - 1;
        if (inBand(qx, qy)) pushPred(enc(qx, qy, 0, 0, w), next);
      }
      // X 的前驱：发射后 cx=gx，cy = max(cqy-1,0)
      if (x >= 1 && cx === gx) {
        const qx = x - 1;
        const cqys = cy === 0 ? (gy >= 1 ? [0, 1] : [0]) : cy < gy ? [cy + 1] : [];
        for (const cqy of cqys) {
          if (inBand(qx, y)) pushPred(enc(qx, y, 0, cqy, w), next);
        }
      }
      // Y 的前驱：发射后 cy=gy，cx = max(cqx-1,0)
      if (y >= 1 && cy === gy) {
        const qy = y - 1;
        const cqxs = cx === 0 ? (gx >= 1 ? [0, 1] : [0]) : cx < gx ? [cx + 1] : [];
        for (const cqx of cqxs) {
          if (inBand(x, qy)) pushPred(enc(x, qy, cqx, 0, w), next);
        }
      }
      // W 的前驱：坐标不变，冷却各按 max(cq-1,0) 反解
      const cqxs = cx === 0 ? (gx >= 1 ? [0, 1] : [0]) : cx < gx ? [cx + 1] : [];
      const cqys = cy === 0 ? (gy >= 1 ? [0, 1] : [0]) : cy < gy ? [cy + 1] : [];
      if (cqxs.length && cqys.length && inBand(x, y)) {
        for (const cqx of cqxs) for (const cqy of cqys) pushPred(enc(x, y, cqx, cqy, w), next);
      }

      if (found) break outer;
    }
    frontier = next;
    depth++;
  }

  const L = dist[startKey];
  if (L < 0) {
    // 理论上位置可达则通过插入等待一定可达；保留防御性分支
    return {
      kind: 'infeasible',
      reason: '无解：冷却状态空间穷举后起点无法到达目标（内部防御性分支，请检查参数）。',
      nearest: pre.nearest,
      diagnostics: { exploredStates: explored, elapsedMs: performance.now() - t0, bfsDepth: depth },
    };
  }

  // 在最短路径 DAG 上按动作字典序 DFS，首个到达目标位置的程序即字典序最小的最短程序
  const isGoal = (key: number) => {
    const s = dec(key, w);
    return s.x === TX && s.y === TY;
  };
  const program: ProgramChar[] = [];
  const stack: { key: number; ai: number }[] = [{ key: startKey, ai: 0 }];
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (isGoal(top.key)) break;
    let advanced = false;
    const s = dec(top.key, w);
    const remain = dist[top.key];
    while (top.ai < ACTION_ORDER.length) {
      const a = ACTION_ORDER[top.ai++];
      const nk = forwardSucc(s, a, p, w);
      if (nk !== null && dist[nk] === remain - 1) {
        program.push(a);
        stack.push({ key: nk, ai: 0 });
        advanced = true;
        break;
      }
    }
    if (!advanced) {
      stack.pop();
      program.pop();
    }
  }

  // 交付前用独立复算器逐时隙核验，确保搜索结果与约束解释完全一致
  const check = replay(program, p);
  if (!check.ok || program.length !== L) {
    throw new Error('内部错误：综合出的程序未通过复算器核验');
  }

  let pulseSlots = 0;
  for (const a of program) if (a !== 'W') pulseSlots++;

  return {
    kind: 'feasible',
    program,
    totalSlots: L,
    pulseSlots,
    waitSlots: L - pulseSlots,
    diagnostics: { exploredStates: explored, elapsedMs: performance.now() - t0, bfsDepth: L },
  };
}
