import {
  ACTION_ORDER,
  ACTION_STEP,
  type Action,
  type PlannerInput,
  type ProgramResult,
  type SolveResult,
  type StepSnapshot,
} from './types';
import { earlyUnsatReason } from './validation';

/** 用户在 UI 中放弃当前搜索时抛出 */
export class SolveCancelledError extends Error {
  constructor() {
    super('搜索已取消');
    this.name = 'SolveCancelledError';
  }
}

const now = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export type SearchStatus = 'running' | 'goal' | 'exhausted' | 'early-unsat';

/**
 * 分块驱动的完整 BFS 搜索。
 *
 * 状态 = (已走X, 已走Y, gx, gy)
 *  gx: 距上一个含 X 脉冲时隙已经经过的“不含 X”时隙数，封顶于 cooldownX
 *      （一旦达到规定间隔，再等待不会改变任何合法动作，封顶是保持搜索完备的等价合并）
 *  gy 同理。
 * 含 X 的动作合法当且仅当 gx >= cooldownX；动作后 gx 归零，否则 gx+1（封顶）。
 * 起始状态 gx = cooldownX、gy = cooldownY：首个脉冲之前不存在“上一个同组脉冲”，随时可发。
 *
 * 完备性/最优性：BFS 按层（时隙数）扩展；每层中父节点按到达先后出队、
 * 子节点严格按 ACTION_ORDER（双轴、X、Y、等待）生成，故目标第一次入队时
 * 其路径既是最小时隙数、又是同长度中字典序最小者。
 *
 * runChunk() 每次至多占用 budgetMs 即返回，使搜索可在 Worker 宏任务间隙
 * 响应取消消息与上报进度；暂停/续跑不改变上述扩展次序，故不影响最优性。
 */
export class PlannerSearch {
  readonly input: PlannerInput;
  readonly earlyReason: string | null;

  private readonly X: number;
  private readonly Y: number;
  private readonly CX: number;
  private readonly CY: number;
  private readonly T: number;
  private readonly dimY: number;
  private readonly dimGX: number;
  private readonly dimGY: number;

  // earlyReason 非空时以下搜索数组不会被创建（runChunk 直接返回 early-unsat）
  private readonly visited!: Uint8Array;
  private readonly parent!: Int32Array;
  private readonly parentAction!: Int8Array;
  private readonly queue!: Int32Array;
  private head = 0;
  private tail = 0;
  private goalId = -1;
  private bestX = 0;
  private bestY = 0;
  private bestProgress = 0;
  private readonly t0: number;

  constructor(input: PlannerInput) {
    this.input = input;
    this.X = input.totalX;
    this.Y = input.totalY;
    this.CX = input.cooldownX;
    this.CY = input.cooldownY;
    this.T = input.tolerance;
    this.dimY = this.Y + 1;
    this.dimGX = this.CX + 1;
    this.dimGY = this.CY + 1;
    this.t0 = now();

    this.earlyReason = earlyUnsatReason(input);
    if (this.earlyReason) return;

    const stateCount = (this.X + 1) * this.dimY * this.dimGX * this.dimGY;
    this.visited = new Uint8Array(stateCount);
    this.parent = new Int32Array(stateCount).fill(-1);
    this.parentAction = new Int8Array(stateCount).fill(-1);
    this.queue = new Int32Array(stateCount);

    const startId = this.encode(0, 0, this.CX, this.CY);
    this.visited[startId] = 1;
    this.parent[startId] = -2;
    this.queue[0] = startId;
    this.tail = 1;
  }

  get visitedCount(): number {
    return this.tail;
  }

  get elapsedMs(): number {
    return Math.round((now() - this.t0) * 100) / 100;
  }

  private encode(x: number, y: number, gx: number, gy: number): number {
    return ((x * this.dimY + y) * this.dimGX + gx) * this.dimGY + gy;
  }

  /** 推进搜索，占用时间接近 budgetMs 后返回当前状态 */
  runChunk(budgetMs: number): SearchStatus {
    if (this.earlyReason) return 'early-unsat';
    if (this.goalId >= 0) return 'goal';
    if (this.head >= this.tail) return 'exhausted';

    const chunkStart = now();
    let processedSinceClockCheck = 0;

    while (this.head < this.tail) {
      const id = this.queue[this.head++];
      const gy = id % this.dimGY;
      let z = (id / this.dimGY) | 0;
      const gx = z % this.dimGX;
      z = (z / this.dimGX) | 0;
      const y = z % this.dimY;
      const x = (z / this.dimY) | 0;

      const progress = x + y;
      if (
        progress > this.bestProgress ||
        (progress === this.bestProgress &&
          x * this.Y + y * this.X > this.bestX * this.Y + this.bestY * this.X)
      ) {
        this.bestProgress = progress;
        this.bestX = x;
        this.bestY = y;
      }

      if (x === this.X && y === this.Y) {
        this.goalId = id;
        return 'goal';
      }

      for (let ai = 0; ai < 4; ai++) {
        const action = ACTION_ORDER[ai];
        const sx = ACTION_STEP[action].x;
        const sy = ACTION_STEP[action].y;

        // 冷却合法性
        if (sx === 1 && gx < this.CX) continue;
        if (sy === 1 && gy < this.CY) continue;

        const nx = x + sx;
        const ny = y + sy;
        if (nx > this.X || ny > this.Y) continue;

        // 工艺走廊：|Y总·已走X − X总·已走Y| <= 上限
        const dev = this.Y * nx - this.X * ny;
        if (dev > this.T || dev < -this.T) continue;

        const ngx = sx === 1 ? 0 : Math.min(gx + 1, this.CX);
        const ngy = sy === 1 ? 0 : Math.min(gy + 1, this.CY);
        const nid = this.encode(nx, ny, ngx, ngy);
        if (this.visited[nid] !== 0) continue;
        this.visited[nid] = 1;
        this.parent[nid] = id;
        this.parentAction[nid] = ai;
        this.queue[this.tail++] = nid;
      }

      // 周期性让出：每 4096 个出队节点检查一次时间片
      processedSinceClockCheck++;
      if ((processedSinceClockCheck & 0xfff) === 0 && now() - chunkStart >= budgetMs) {
        return 'running';
      }
    }
    return 'exhausted';
  }

  /** 搜索终止（goal/exhausted/early-unsat）后构造结果 */
  buildResult(): SolveResult {
    if (this.earlyReason) {
      return {
        kind: 'unsat',
        input: this.input,
        reason: this.earlyReason,
        stats: { visited: 0, enqueued: 0, elapsedMs: this.elapsedMs },
      };
    }

    const stats = {
      visited: this.tail,
      enqueued: this.tail,
      elapsedMs: this.elapsedMs,
    };

    if (this.goalId < 0) {
      return {
        kind: 'unsat',
        input: this.input,
        reason:
          `完整搜索穷尽了 ${this.tail.toLocaleString()} 个可达状态，仍无法到达 (${this.X}, ${this.Y})：` +
          `冷却约束（X 间隔 ${this.CX}、Y 间隔 ${this.CY}）与偏差走廊（上限 ${this.T}）共同构成死局，` +
          `搜索可达的最远位置为 (${this.bestX}, ${this.bestY})，此后任何合规动作都会越界或超出发数。`,
        stats,
      };
    }

    // 回溯动作序列
    const actionsRev: Action[] = [];
    let cur = this.goalId;
    while (this.parent[cur] >= 0) {
      actionsRev.push(ACTION_ORDER[this.parentAction[cur]]);
      cur = this.parent[cur];
    }
    const actions = actionsRev.reverse();

    return {
      kind: 'ok',
      input: this.input,
      actions,
      slots: simulate(this.input, actions).snapshots,
      stats,
    } satisfies ProgramResult;
  }
}

/**
 * 同步完整搜索（测试与 Node 侧交叉验证使用；浏览器 UI 走 Worker 分块驱动）。
 * 最小时隙数，再按 双轴 < X < Y < 等待 的字典序取最小程序。
 */
export function solve(
  input: PlannerInput,
  shouldCancel?: () => boolean,
): SolveResult {
  const search = new PlannerSearch(input);
  let guard = 0;
  for (;;) {
    if (shouldCancel?.()) throw new SolveCancelledError();
    const status = search.runChunk(1000);
    if (status === 'early-unsat' || status === 'goal' || status === 'exhausted') {
      return search.buildResult();
    }
    if (++guard > 1_000_000) throw new Error('搜索超过最大分块数');
  }
}

/** 逐时隙复算结果 */
export interface Simulation {
  snapshots: StepSnapshot[];
  /** 复算发现的问题（空数组表示程序完全合规） */
  violations: string[];
  finalX: number;
  finalY: number;
}

/**
 * 独立逐时隙复算：不使用搜索过程中的任何中间数据，
 * 仅依据输入与动作序列重放，逐时隙核对冷却、步数与偏差走廊。
 * 用于表格/轨迹/曲线/导出 JSON 的同源生成与验收复核。
 */
export function simulate(input: PlannerInput, actions: readonly Action[]): Simulation {
  const { totalX: X, totalY: Y, cooldownX: CX, cooldownY: CY, tolerance: T } =
    input;
  const snapshots: StepSnapshot[] = [];
  const violations: string[] = [];

  let x = 0;
  let y = 0;
  let gx = CX;
  let gy = CY;

  actions.forEach((action, i) => {
    const slot = i + 1;
    if (!ACTION_ORDER.includes(action)) {
      violations.push(`时隙 ${slot}：未知动作 "${String(action)}"`);
      return;
    }
    const sx = ACTION_STEP[action].x;
    const sy = ACTION_STEP[action].y;

    if (sx === 1 && gx < CX) {
      violations.push(
        `时隙 ${slot}：X 脉冲违反冷却，前面仅有 ${gx} 个不含 X 时隙，要求至少 ${CX} 个`,
      );
    }
    if (sy === 1 && gy < CY) {
      violations.push(
        `时隙 ${slot}：Y 脉冲违反冷却，前面仅有 ${gy} 个不含 Y 时隙，要求至少 ${CY} 个`,
      );
    }

    x += sx;
    y += sy;
    if (x > X) violations.push(`时隙 ${slot}：X 累计步数 ${x} 超过总步数 ${X}`);
    if (y > Y) violations.push(`时隙 ${slot}：Y 累计步数 ${y} 超过总步数 ${Y}`);

    const deviation = Y * x - X * y;
    if (Math.abs(deviation) > T) {
      violations.push(
        `时隙 ${slot}：偏差 |${Y}×${x} − ${X}×${y}| = ${Math.abs(deviation)} 超过上限 ${T}`,
      );
    }

    snapshots.push({
      slot,
      action,
      xAfter: x,
      yAfter: y,
      deviation,
      absDeviation: Math.abs(deviation),
      xGapBefore: gx,
      yGapBefore: gy,
    });

    gx = sx === 1 ? 0 : Math.min(gx + 1, CX);
    gy = sy === 1 ? 0 : Math.min(gy + 1, CY);
  });

  if (x !== X) {
    violations.push(`程序结束时 X 共走 ${x} 步，与总步数 ${X} 不一致`);
  }
  if (y !== Y) {
    violations.push(`程序结束时 Y 共走 ${y} 步，与总步数 ${Y} 不一致`);
  }

  return { snapshots, violations, finalX: x, finalY: y };
}
