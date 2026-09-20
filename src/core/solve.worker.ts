import { Params } from './validation';
import { solve, SolveOutcome } from './scheduler';

// 在独立线程综合，最坏情形（约千万级冷却状态）也不冻结界面
self.onmessage = (e: MessageEvent<{ id: number; params: Params }>) => {
  const { id, params } = e.data;
  try {
    const outcome: SolveOutcome = solve(params);
    (self as unknown as Worker).postMessage({ id, outcome });
  } catch (err) {
    (self as unknown as Worker).postMessage({
      id,
      outcome: {
        kind: 'infeasible',
        reason: `综合过程出错：${(err as Error).message}`,
        nearest: { x: 0, y: 0 },
        diagnostics: { exploredStates: 0, elapsedMs: 0, bfsDepth: 0 },
      } satisfies SolveOutcome,
    });
  }
};
