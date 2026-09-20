/// <reference lib="webworker" />
import { PlannerSearch } from './solver';
import type { WorkerRequest, WorkerResponse } from './protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let currentId: number | null = null;
let cancelled = false;
let lastProgressPost = 0;

const post = (msg: WorkerResponse) => ctx.postMessage(msg);

const drive = (search: PlannerSearch, id: number) => {
  // 该请求已被更新的请求取代或被用户取消
  if (currentId !== id || cancelled) return;

  const status = search.runChunk(24); // 每片至多约 24ms，随后让出事件循环
  const nowMs =
    typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (nowMs - lastProgressPost > 250) {
    lastProgressPost = nowMs;
    post({ type: 'progress', id, visited: search.visitedCount });
  }

  if (status === 'running') {
    // 下一个宏任务继续；期间排队的 cancel/solve 消息有机会被分发处理
    setTimeout(() => drive(search, id), 0);
    return;
  }

  if (currentId === id && !cancelled) {
    post({ type: 'done', id, result: search.buildResult() });
  }
};

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;

  if (msg.type === 'cancel') {
    if (msg.id === currentId) cancelled = true;
    return;
  }

  if (msg.type === 'solve') {
    // 取代（并随之作废）任何仍在分块循环中的旧请求
    currentId = msg.id;
    cancelled = false;
    lastProgressPost = 0;
    try {
      const search = new PlannerSearch(msg.input);
      drive(search, msg.id);
    } catch (err) {
      post({
        type: 'error',
        id: msg.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
