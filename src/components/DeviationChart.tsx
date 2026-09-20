import { Params } from '../core/validation';
import { PrefixState } from '../core/types';

interface Props {
  params: Params;
  states: PrefixState[];
  cursor: number;
}

const W = 460;
const H = 380;
const PAD_L = 52;
const PAD_R = 14;
const PAD_T = 16;
const PAD_B = 34;

/** 偏差曲线：每个非初始前缀 D = 总Y·x − 总X·y，含 ±上限 走廊线与游标 */
export default function DeviationChart({ params, states, cursor }: Props) {
  const { tolerance: tol } = params;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const slots = states.length - 1;

  let maxAbs = tol;
  for (const s of states) maxAbs = Math.max(maxAbs, Math.abs(s.deviation));
  maxAbs = Math.max(1, maxAbs);
  const yScale = plotH / (2 * maxAbs);
  const X = (slot: number) => PAD_L + (slots === 0 ? 0 : (slot / slots) * plotW);
  const Y = (d: number) => PAD_T + plotH / 2 - d * yScale;

  const pts = states.slice(1).map((s) => `${X(s.slot).toFixed(1)},${Y(s.deviation).toFixed(1)}`);

  const yTicks = [-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="偏差曲线">
      {/* 走廊 */}
      <rect x={PAD_L} y={Y(tol)} width={plotW} height={Y(-tol) - Y(tol)} fill="rgba(53,208,127,0.10)" />
      <line x1={PAD_L} y1={Y(tol)} x2={W - PAD_R} y2={Y(tol)} stroke="#35d07f" strokeWidth={1} strokeDasharray="6 3" />
      <line x1={PAD_L} y1={Y(-tol)} x2={W - PAD_R} y2={Y(-tol)} stroke="#35d07f" strokeWidth={1} strokeDasharray="6 3" />
      <text x={W - PAD_R - 4} y={Y(tol) - 3} fill="#35d07f" fontSize={10} textAnchor="end">+{tol}</text>
      <text x={W - PAD_R - 4} y={Y(-tol) + 11} fill="#35d07f" fontSize={10} textAnchor="end">−{tol}</text>

      {/* 零线与 y 刻度 */}
      <line x1={PAD_L} y1={Y(0)} x2={W - PAD_R} y2={Y(0)} stroke="#5f7398" strokeWidth={1} />
      {yTicks.map((t, i) => (
        <text key={i} x={PAD_L - 6} y={Y(t) + 3} fill="#93a4bf" fontSize={10} textAnchor="end">
          {Math.round(t)}
        </text>
      ))}
      <text x={14} y={PAD_T + plotH / 2} fill="#93a4bf" fontSize={11} textAnchor="middle" transform={`rotate(-90 14 ${PAD_T + plotH / 2})`}>
        偏差 D
      </text>

      {/* 偏差曲线（阶梯式逐时隙） */}
      {pts.length > 1 && <polyline points={pts.join(' ')} fill="none" stroke="#4da3ff" strokeWidth={2} />}
      {states.slice(1, cursor + 1).map((s) => (
        <circle key={s.slot} cx={X(s.slot)} cy={Y(s.deviation)} r={2} fill="#8fc4ff" />
      ))}

      {/* x 轴 */}
      <text x={PAD_L + plotW / 2} y={H - 8} fill="#93a4bf" fontSize={11} textAnchor="middle">时隙</text>
      <text x={PAD_L} y={H - 8} fill="#93a4bf" fontSize={10}>0</text>
      <text x={W - PAD_R} y={H - 8} fill="#93a4bf" fontSize={10} textAnchor="end">{slots}</text>

      {/* 游标 */}
      {cursor >= 1 && cursor <= slots && (
        <g>
          <line x1={X(cursor)} y1={PAD_T} x2={X(cursor)} y2={PAD_T + plotH} stroke="#ffb020" strokeWidth={1.2} />
          <circle cx={X(cursor)} cy={Y(states[cursor].deviation)} r={5} fill="#ffb020" stroke="#0f1521" strokeWidth={2} />
        </g>
      )}
    </svg>
  );
}
