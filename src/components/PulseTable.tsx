import { useEffect, useRef } from 'react';
import { PrefixState, ACTION_NAME } from '../core/types';
import { Params } from '../core/validation';

interface Props {
  params: Params;
  states: PrefixState[];
  cursor: number;
}

/** 逐时隙脉冲表：动作、脉冲、累计坐标、偏差、冷却余量，全部由复算器输出 */
export default function PulseTable({ params, states, cursor }: Props) {
  const activeRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>时隙</th>
            <th>动作</th>
            <th>X 脉冲</th>
            <th>Y 脉冲</th>
            <th>累计 X</th>
            <th>累计 Y</th>
            <th>偏差 D=总Y·x−总X·y</th>
            <th>|D|≤{params.tolerance}</th>
            <th>X 冷却余量</th>
            <th>Y 冷却余量</th>
          </tr>
        </thead>
        <tbody>
          {states.slice(1).map((s) => {
            const dx = s.action === 'B' || s.action === 'X' ? 1 : 0;
            const dy = s.action === 'B' || s.action === 'Y' ? 1 : 0;
            return (
              <tr key={s.slot} ref={s.slot === cursor ? activeRef : null} className={s.slot === cursor ? 'active' : ''}>
                <td>{s.slot}</td>
                <td>
                  <span className={`tag ${s.action}`}>{ACTION_NAME[s.action!]}</span>
                </td>
                <td>{dx}</td>
                <td>{dy}</td>
                <td>{s.x}</td>
                <td>{s.y}</td>
                <td>{s.deviation}</td>
                <td style={{ color: Math.abs(s.deviation) <= params.tolerance ? '#35d07f' : '#ff5f6d' }}>
                  {Math.abs(s.deviation) <= params.tolerance ? '✓' : '✗'}
                </td>
                <td>{s.cooldownX}</td>
                <td>{s.cooldownY}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
