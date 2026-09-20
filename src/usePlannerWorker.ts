import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlannerInput, SolveResult } from './core/types';
import type { WorkerRequest, WorkerResponse } from './core/protocol';

export type SolveStatus = 'idle' | 'working' | 'done' | 'error' | 'cancelled';

export interface PlannerState {
  status: SolveStatus;
  result: SolveResult | null;
  errorMessage: string | null;
  requestId: number;
  /** 搜索中已发现的可达状态数（进度，约每 250ms 更新） */
  progressVisited: number;
}

/**
 * Web Worker 客户端：完整搜索在后台线程运行，不阻塞时间游标与界面。
 * 旧请求在新求解发起时自动取消，回调只投递最新一次结果。
 */
export function usePlannerWorker() {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const [state, setState] = useState<PlannerState>({
    status: 'idle',
    result: null,
    errorMessage: null,
    requestId: 0,
    progressVisited: 0,
  });

  useEffect(() => {
    const worker = new Worker(new URL('./core/solver.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.id !== requestIdRef.current) return; // 已被更新请求取代
      if (msg.type === 'progress') {
        setState((s) =>
          s.requestId === msg.id && s.status === 'working'
            ? { ...s, progressVisited: msg.visited }
            : s,
        );
      } else if (msg.type === 'done') {
        // 用户刚刚点了取消、而终态消息恰在取消生效前发出：保留“已取消”，不回填结果
        setState((s) =>
          s.requestId === msg.id && s.status === 'cancelled'
            ? s
            : { status: 'done', result: msg.result, errorMessage: null, requestId: msg.id, progressVisited: 0 },
        );
      } else if (msg.type === 'error') {
        setState((s) =>
          s.requestId === msg.id && s.status === 'cancelled'
            ? s
            : { status: 'error', result: null, errorMessage: msg.message, requestId: msg.id, progressVisited: 0 },
        );
      }
    };
    return () => worker.terminate();
  }, []);

  const solve = useCallback((input: PlannerInput) => {
    const worker = workerRef.current;
    if (!worker) return;
    requestIdRef.current += 1;
    const id = requestIdRef.current;
    // 取消上一个仍在运行的搜索
    worker.postMessage({ type: 'cancel', id: id - 1 } satisfies WorkerRequest);
    worker.postMessage({ type: 'solve', id, input } satisfies WorkerRequest);
    setState({ status: 'working', result: null, errorMessage: null, requestId: id, progressVisited: 1 });
  }, []);

  const cancel = useCallback(() => {
    const worker = workerRef.current;
    if (!worker) return;
    worker.postMessage({ type: 'cancel', id: requestIdRef.current } satisfies WorkerRequest);
    setState((s) =>
      s.status === 'working'
        ? { ...s, status: 'cancelled' }
        : s,
    );
  }, []);

  /** 丢弃当前结果并作废仍在运行的搜索（非法输入或非法导入时清除旧结果） */
  const clear = useCallback(() => {
    const worker = workerRef.current;
    const oldId = requestIdRef.current;
    // 递增请求号：该搜索此后的任何回调都因 id 失配被丢弃
    requestIdRef.current += 1;
    worker?.postMessage({ type: 'cancel', id: oldId } satisfies WorkerRequest);
    setState({ status: 'idle', result: null, errorMessage: null, requestId: requestIdRef.current, progressVisited: 0 });
  }, []);

  return { ...state, solve, cancel, clear };
}
