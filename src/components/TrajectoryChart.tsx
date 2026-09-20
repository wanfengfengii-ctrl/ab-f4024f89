import { Params } from '../core/validation';
import { PrefixState } from '../core/types';

interface Props {
  params: Params;
  states: PrefixState[];
  cursor: number;
}

const W = 460;
const H = 380;
const PAD = 38;

/** 坐标轨迹图：理想直线、偏差走廊（按上限几何绘制）、实际脉冲路径、游标位置 */
export default function TrajectoryChart({ params, states, cursor }: Props) {
  const { totalX: TX, totalY: TY, tolerance: tol } = params;
  const plotW = W - PAD - 14;
  const plotH = H - PAD - 14;
  const sx = plotW / TX;
  const sy = plotH / TY;
  // SVG y 向下，翻转
  const X = (x: number) => PAD + x * sx;
  const Y = (y: number) => 14 + plotH - y * sy;

  const linePts: string[] = [];
  for (let i = 0; i <= Math.max(TX, TY) * 4; i++) {
    const t = i / (Math.max(TX, TY) * 4);
    linePts.push(`${X(t * TX).toFixed(1)},${Y(t * TY).toFixed(1)}`);
  }

  // 走廊：y ∈ [(TY*x - tol)/TX, (TY*x + tol)/TX]，沿 x 采样后闭合
  const bandTop: string[] = [];
  const bandBottom: string[] = [];
  const N = 200;
  for (let i = 0; i <= N; i++) {
    const x = (TX * i) / N;
    const yHi = Math.min(TY, (TY * x + tol) / TX);
    const yLo = Math.max(0, (TY * x - tol) / TX);
    bandTop.push(`${X(x).toFixed(1)},${Y(yHi).toFixed(1)}`);
    bandBottom.push(`${X(x).toFixed(1)},${Y(yLo).toFixed(1)}`);
  }
  const bandPath = `M${bandTop.join(' L')} L${bandBottom.reverse().join(' L')} Z`;

  const pathPts = states.slice(0, cursor + 1).map((s) => `${X(s.x).toFixed(1)},${Y(s.y).toFixed(1)}`);
  const cur = states[Math.min(cursor, states.length - 1)];

  const gridX = TX <= 20 ? 1 : Math.ceil(TX / 10);
  const gridY = TY <= 20 ? 1 : Math.ceil(TY / 10);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="坐标轨迹图">
      {/* 网格与刻度 */}
      {Array.from({ length: TX + 1 }, (_, i) => i).filter((i) => i % gridX === 0).map((i) => (
        <g key={`gx${i}`}>
          <line x1={X(i)} y1={Y(0)} x2={X(i)} y2={Y(TY)} stroke="#23304a" strokeWidth={1} />
          <text x={X(i)} y={H - 12} fill="#93a4bf" fontSize={10} textAnchor="middle">{i}</text>
        </g>
      ))}
      {Array.from({ length: TY + 1 }, (_, i) => i).filter((i) => i % gridY === 0).map((i) => (
        <g key={`gy${i}`}>
          <line x1={X(0)} y1={Y(i)} x2={X(TX)} y2={Y(i)} stroke="#23304a" strokeWidth={1} />
          <text x={PAD - 6} y={Y(i) + 3} fill="#93a4bf" fontSize={10} textAnchor="end">{i}</text>
        </g>
      ))}
      <text x={PAD + plotW / 2} y={H - 0} fill="#93a4bf" fontSize={11} textAnchor="middle">X 累计步数</text>
      <text x={12} y={14 + plotH / 2} fill="#93a4bf" fontSize={11} textAnchor="middle" transform={`rotate(-90 12 ${14 + plotH / 2})`}>Y 累计步数</text>

      {/* 偏差走廊 */}
      <path d={bandPath} fill="rgba(77,163,255,0.12)" stroke="none" />
      {/* 理想直线 */}
      <polyline points={linePts.join(' ')} fill="none" stroke="#5f7398" strokeWidth={1.2} strokeDasharray="5 4" />
      {/* 实际路径 */}
      {pathPts.length > 1 && (
        <polyline points={pathPts.join(' ')} fill="none" stroke="#4da3ff" strokeWidth={2} strokeLinejoin="round" />
      )}
      {/* 已访问格点 */}
      {states.slice(1, cursor + 1).map((s) => (
        <circle key={s.slot} cx={X(s.x)} cy={Y(s.y)} r={1.6} fill="#8fc4ff" />
      ))}
      {/* 目标 */}
      <rect x={X(TX) - 4} y={Y(TY) - 4} width={8} height={8} fill="#35d07f" />
      {/* 游标当前坐标 */}
      {cur && (
        <g>
          <circle cx={X(cur.x)} cy={Y(cur.y)} r={5} fill="#ffb020" stroke="#0f1521" strokeWidth={2} />
          <text x={X(cur.x) + 8} y={Y(cur.y) - 6} fill="#ffd98a" fontSize={10}>
            ({cur.x},{cur.y})
          </text>
        </g>
      )}
    </svg>
  );
}
