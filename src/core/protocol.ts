import type { PlannerInput, SolveResult } from './types';

export type WorkerRequest =
  | { type: 'solve'; id: number; input: PlannerInput }
  | { type: 'cancel'; id: number };

export type WorkerResponse =
  | { type: 'progress'; id: number; visited: number }
  | { type: 'done'; id: number; result: SolveResult }
  | { type: 'error'; id: number; message: string };
