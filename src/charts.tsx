import { useEffect, useRef } from 'react';
import {
  ACTION_LABEL,
  ACTION_STEP,
  type Action,
  type PlannerInput,
  type StepSnapshot,
} from './core/types';

const ACTION_COLOR: Record<Action, string> = {
  XY: '#c08cff',
  X: '#4ea1ff',
  Y: '#ff9d4e',
  WAIT: '#6b7686',
};

/** 坐标轨迹：累计 (X,Y) 步进折线 + 理论直线 + 偏差走廊边界 + 时间游标位置 */
export function TrajectoryChart({
  input,
  slots,
  cursor,
}: {
  input: PlannerInput;
  slots: StepSnapshot[];
  cursor: number;
}) {
  const { totalX: X, totalY: Y, tolerance: T } = input;
  const W = 560;
  const H = 420;
  const PAD_L = 46;
  const PAD_R = 18;
  const PAD_T = 18;
  const PAD_B = 38;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  // 坐标范围覆盖理论直线及脉冲路径（走廊带超出部分由 SVG 视口自然裁剪）
  const xMax = X + 0.5;
  const yMax = Y + 0.5;
  const sx = (x: number) => PAD_L + (x / xMax) * plotW;
  const sy = (y: number) => PAD_T + plotH - (y / yMax) * plotH;

  // 理论直线 y = (Y/X) x
  const linePath = `M ${sx(0)} ${sy(0)} L ${sx(X)} ${sy(Y)}`;
  // 走廊边界：偏差 = ±T，即 y = (Y x ∓ T)/X
  const upperAt = (x: number) => (Y * x - T) / X;
  const lowerAt = (x: number) => (Y * x + T) / X;
  const corridorPath =
    `M ${sx(0)} ${sy(upperAt(0))} L ${sx(xMax)} ${sy(upperAt(xMax))} ` +
    `L ${sx(xMax)} ${sy(lowerAt(xMax))} L ${sx(0)} ${sy(lowerAt(0))} Z`;

  const points = slots;
  const stepPath = slots
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${sx(s.xAfter)} ${sy(s.yAfter)}`)
    .join(' ');

  const cur = cursor === 0 ? null : slots[cursor - 1] ?? null;
  const curX = cursor === 0 ? 0 : cur!.xAfter;
  const curY = cursor === 0 ? 0 : cur!.yAfter;

  // 网格刻度
  const xticks = Array.from({ length: Math.min(X + 1, 9) }, (_, i) =>
    Math.round((i / Math.min(X, 8)) * X),
  );
  const yticks = Array.from({ length: Math.min(Y + 1, 9) }, (_, i) =>
    Math.round((i / Math.min(Y, 8)) * Y),
  );

  const showDots = slots.length <= 500;

  return (
    <div className="chart-wrap" data-testid="trajectory-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="坐标轨迹图">
        {/* 走廊带 */}
        <path d={corridorPath} fill="rgba(57,217,138,0.07)" stroke="none" />
        {/* 网格与刻度 */}
        {xticks.map((t) => (
          <g key={`x${t}`}>
            <line x1={sx(t)} y1={PAD_T} x2={sx(t)} y2={PAD_T + plotH}
              stroke="#222a34" strokeWidth={1} />
            <text x={sx(t)} y={H - 14} fill="#8b97a7" fontSize={10} textAnchor="middle">{t}</text>
          </g>
        ))}
        {yticks.map((t) => (
          <g key={`y${t}`}>
            <line x1={PAD_L} y1={sy(t)} x2={PAD_L + plotW} y2={sy(t)}
              stroke="#222a34" strokeWidth={1} />
            <text x={PAD_L - 6} y={sy(t) + 3.5} fill="#8b97a7" fontSize={10} textAnchor="end">{t}</text>
          </g>
        ))}
        {/* 坐标轴 */}
        <line x1={sx(0)} y1={sy(0)} x2={sx(xMax)} y2={sy(0)} stroke="#3a4452" />
        <line x1={sx(0)} y1={sy(0)} x2={sx(0)} y2={sy(yMax)} stroke="#3a4452" />
        <text x={PAD_L + plotW} y={H - 14} fill="#8b97a7" fontSize={11} textAnchor="end">X 累计步数 →</text>
        <text x={12} y={PAD_T + 8} fill="#8b97a7" fontSize={11}>Y ↑</text>

        {/* 理论直线 */}
        <path d={linePath} stroke="#39d98a" strokeWidth={1.4} strokeDasharray="6 4" fill="none" />
        <circle cx={sx(X)} cy={sy(Y)} r={4} fill="#39d98a" />
        <text x={sx(X) + 6} y={sy(Y) + 4} fill="#39d98a" fontSize={10}>
          终点 ({X},{Y})
        </text>

        {/* 步进轨迹 */}
        {slots.length > 0 && (
          <path d={stepPath} stroke="#9fb4cc" strokeWidth={1.2} fill="none"
            strokeLinejoin="round" />
        )}
        {showDots &&
          points.map((s) => (
            <circle key={s.slot} cx={sx(s.xAfter)} cy={sy(s.yAfter)} r={2.6}
              fill={ACTION_COLOR[s.action]} opacity={s.slot <= cursor ? 1 : 0.35} />
          ))}
        {/* 游标点 */}
        <circle cx={sx(curX)} cy={sy(curY)} r={5.5} fill="none"
          stroke="#fff" strokeWidth={2} />
        <circle cx={sx(curX)} cy={sy(curY)} r={3}
          fill={cur ? ACTION_COLOR[cur.action] : '#fff'} />
      </svg>
      <div className="legend">
        <span><span className="dot" style={{ background: '#39d98a' }} />理论直线 / 终点</span>
        <span><span className="dot" style={{ background: 'rgba(57,217,138,0.35)' }} />偏差走廊 (±{T})</span>
        {(['XY', 'X', 'Y', 'WAIT'] as Action[]).map((a) => (
          <span key={a}><span className="dot" style={{ background: ACTION_COLOR[a] }} />{ACTION_LABEL[a]}</span>
        ))}
      </div>
    </div>
  );
}

/** 偏差曲线：每个非初始前缀的偏差 d = Y总·已走X − X总·已走Y，含 ±上限 带与游标 */
export function DeviationChart({
  input,
  slots,
  cursor,
}: {
  input: PlannerInput;
  slots: StepSnapshot[];
  cursor: number;
}) {
  const { tolerance: T } = input;
  const n = slots.length;
  const W = 560;
  const H = 420;
  const PAD_L = 52;
  const PAD_R = 18;
  const PAD_T = 18;
  const PAD_B = 38;
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;

  const maxAbs = Math.max(T, ...slots.map((s) => s.absDeviation), 1);
  const yTop = maxAbs * 1.1;
  const sx = (k: number) =>
    PAD_L + (n <= 1 ? plotW / 2 : (k / n) * plotW);
  const sy = (d: number) => PAD_T + plotH / 2 - (d / yTop) * (plotH / 2);

  const linePath = slots
    .map((s, i) => `${i === 0 ? 'M' : 'L'} ${sx(s.slot)} ${sy(s.deviation)}`)
    .join(' ');
  const zeroPath = `M ${PAD_L} ${sy(0)} L ${PAD_L + plotW} ${sy(0)}`;

  const cur = cursor === 0 ? null : slots[cursor - 1] ?? null;

  return (
    <div className="chart-wrap" data-testid="deviation-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="偏差曲线图">
        {/* 允许走廊带 */}
        <rect x={PAD_L} y={sy(T)} width={plotW} height={sy(-T) - sy(T)}
          fill="rgba(57,217,138,0.07)" />
        <line x1={PAD_L} y1={sy(T)} x2={PAD_L + plotW} y2={sy(T)}
          stroke="#39d98a" strokeWidth={1} strokeDasharray="5 3" />
        <line x1={PAD_L} y1={sy(-T)} x2={PAD_L + plotW} y2={sy(-T)}
          stroke="#39d98a" strokeWidth={1} strokeDasharray="5 3" />
        <text x={PAD_L + plotW} y={sy(T) - 4} fill="#39d98a" fontSize={10} textAnchor="end">+{T}</text>
        <text x={PAD_L + plotW} y={sy(-T) + 11} fill="#39d98a" fontSize={10} textAnchor="end">−{T}</text>
        <path d={zeroPath} stroke="#3a4452" strokeWidth={1} />
        <text x={PAD_L - 6} y={sy(0) + 3.5} fill="#8b97a7" fontSize={10} textAnchor="end">0</text>

        {n > 0 && <path d={linePath} stroke="#4ea1ff" strokeWidth={1.3} fill="none" />}

        {/* 游标 */}
        {cur && (
          <g>
            <line x1={sx(cur.slot)} y1={PAD_T} x2={sx(cur.slot)} y2={PAD_T + plotH}
              stroke="#fff" strokeWidth={1} opacity={0.6} />
            <circle cx={sx(cur.slot)} cy={sy(cur.deviation)} r={4.5}
              fill={ACTION_COLOR[cur.action]} stroke="#fff" strokeWidth={1.5} />
          </g>
        )}
        <text x={PAD_L + plotW} y={H - 14} fill="#8b97a7" fontSize={11} textAnchor="end">时隙 →</text>
        <text x={12} y={PAD_T + 8} fill="#8b97a7" fontSize={11}>偏差 d</text>
      </svg>
      <div className="legend">
        <span><span className="dot" style={{ background: 'rgba(57,217,138,0.35)' }} />允许区间 [−{T}, +{T}]</span>
        <span><span className="dot" style={{ background: '#4ea1ff' }} />d = {input.totalY}·已走X − {input.totalX}·已走Y</span>
      </div>
    </div>
  );
}

/** 脉冲表：逐时隙动作、累计坐标、偏差与冷却间隔；点击行即移动时间游标 */
export function PulseTable({
  slots,
  cursor,
  onCursor,
}: {
  slots: StepSnapshot[];
  cursor: number;
  onCursor: (slot: number) => void;
}) {
  const activeRef = useRef<HTMLTableRowElement | null>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  return (
    <div className="table-scroll" data-testid="pulse-table">
      <table className="pulse">
        <thead>
          <tr>
            <th className="slot">时隙</th>
            <th>动作</th>
            <th>X 脉冲</th>
            <th>Y 脉冲</th>
            <th>已走 X</th>
            <th>已走 Y</th>
            <th>偏差 d</th>
            <th>|d|</th>
            <th>动作前 X 间隔</th>
            <th>动作前 Y 间隔</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => {
            const st = ACTION_STEP[s.action];
            return (
              <tr key={s.slot}
                ref={s.slot === cursor ? activeRef : null}
                className={s.slot === cursor ? 'cursor-row-active' : ''}
                onClick={() => onCursor(s.slot)}>
                <td className="slot mono">{s.slot}</td>
                <td><span className={`act-chip act-${s.action}`}>{ACTION_LABEL[s.action]}</span></td>
                <td>{st.x}</td>
                <td>{st.y}</td>
                <td>{s.xAfter}</td>
                <td>{s.yAfter}</td>
                <td className="mono">{s.deviation}</td>
                <td className="mono">{s.absDeviation}</td>
                <td>{s.xGapBefore}</td>
                <td>{s.yGapBefore}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
