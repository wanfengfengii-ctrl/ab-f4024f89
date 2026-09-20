import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlannerWorker } from './usePlannerWorker';
import { validateInput } from './core/validation';
import { simulate } from './core/solver';
import {
  ACTION_LABEL,
  type PlannerInput,
  type ProgramResult,
  type StepSnapshot,
} from './core/types';
import { buildExportedProgram, parseImportedProgram } from './core/transfer';
import { DeviationChart, PulseTable, TrajectoryChart } from './charts';

type FieldKey = keyof PlannerInput;

const FIELD_DEFS: { key: FieldKey; label: string; min: number; max: number; hint: string }[] = [
  { key: 'totalX', label: 'X 轴总步数', min: 1, max: 400, hint: '整数 1~400' },
  { key: 'totalY', label: 'Y 轴总步数', min: 1, max: 400, hint: '整数 1~400' },
  { key: 'cooldownX', label: 'X 冷却间隔', min: 0, max: 8, hint: '相邻 X 脉冲间至少隔开的不含 X 时隙数（0~8）' },
  { key: 'cooldownY', label: 'Y 冷却间隔', min: 0, max: 8, hint: '相邻 Y 脉冲间至少隔开的不含 Y 时隙数（0~8）' },
  { key: 'tolerance', label: '偏差上限', min: 0, max: -1, hint: '非负整数：|Y总·已走X − X总·已走Y| ≤ 上限' },
];

const DEFAULTS: Record<FieldKey, string> = {
  totalX: '24',
  totalY: '16',
  cooldownX: '1',
  cooldownY: '2',
  tolerance: '8',
};

interface ImportedView {
  program: ProgramResult;
  fileName: string;
}

export default function App() {
  const [raw, setRaw] = useState<Record<FieldKey, string>>(DEFAULTS);
  const [submittedErrors, setSubmittedErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [globalErrors, setGlobalErrors] = useState<string[]>([]);
  const [cursor, setCursor] = useState(0);
  const [imported, setImported] = useState<ImportedView | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const worker = usePlannerWorker();
  const solved: ProgramResult | null =
    worker.result?.kind === 'ok' ? worker.result : null;
  const unsat = worker.result?.kind === 'unsat' ? worker.result : null;
  const working = worker.status === 'working';

  // 当前展示的程序：优先显示最新完整搜索结果，其次显示已复算的导入程序
  const program: ProgramResult | null = solved ?? imported?.program ?? null;
  const showingImported = !solved && !!imported;

  // 参数与当前程序是否一致（不一致时视图标记为过期，禁止误导出）
  const parsedNow = useMemo(() => validateInput(raw).value, [raw]);
  const programInputMatches = program && parsedNow
    ? JSON.stringify(program.input) === JSON.stringify(parsedNow)
    : false;
  const stale = !!program && !programInputMatches;
  const unsatStale = !!unsat && !!parsedNow
    ? JSON.stringify(unsat.input) !== JSON.stringify(parsedNow)
    : false;

  useEffect(() => {
    if (program) setCursor((c) => Math.min(c, program.actions.length));
  }, [program]);

  // 首屏用默认参数自动求解一次（开发环境 StrictMode 的双调用会自动作废旧请求）
  const autoSolvedRef = useRef(false);
  useEffect(() => {
    if (autoSolvedRef.current) return;
    autoSolvedRef.current = true;
    const { value } = validateInput(DEFAULTS);
    if (value) worker.solve(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slots: StepSnapshot[] = program?.slots ?? [];

  // 独立复算：成功结果在渲染时再核对一次（与导出 JSON 走同一 simulate）
  const reverify = useMemo(
    () => (program ? simulate(program.input, program.actions) : null),
    [program],
  );

  const runSolve = () => {
    const { value, errors } = validateInput(raw);
    const map: Partial<Record<FieldKey, string>> = {};
    errors.forEach((e) => { if (!map[e.field]) map[e.field] = e.message; });
    setSubmittedErrors(map);
    setGlobalErrors([]);
    setImported(null);
    if (!value) {
      // 非法输入：一次标出全部问题并清除旧结果
      worker.clear();
      setCursor(0);
      setGlobalErrors(['输入存在问题，已清除上一次结果：']);
      return;
    }
    setCursor(0);
    worker.solve(value);
  };

  const onExport = () => {
    if (!program || !programInputMatches || (reverify && reverify.violations.length > 0)) return;
    // 无搜索统计（导入程序）时仍可导出，但导出对象以当前 program 为准
    const exported = buildExportedProgram(program);
    const blob = new Blob([JSON.stringify(exported, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const tag = showingImported ? 'imported' : 'solved';
    a.download = `pulse-program-x${program.input.totalX}-y${program.input.totalY}-${tag}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const onImportFile = async (file: File) => {
    const text = await file.text();
    const check = parseImportedProgram(text);
    if (!check.ok || !check.input) {
      setGlobalErrors([`导入失败：${file.name}`, ...check.errors.map((m) => `· ${m}`)]);
      setSubmittedErrors({});
      // 非法导入不展示任何程序（清除旧结果与首屏默认结果）
      worker.clear();
      setImported(null);
      return;
    }
    setGlobalErrors([]);
    setSubmittedErrors({});
    // 导入的程序取代任何已有搜索结果
    worker.clear();
    const next: Record<FieldKey, string> = {
      totalX: String(check.input.totalX),
      totalY: String(check.input.totalY),
      cooldownX: String(check.input.cooldownX),
      cooldownY: String(check.input.cooldownY),
      tolerance: String(check.input.tolerance),
    };
    setRaw(next);

    if (check.actions) {
      // 导入程序已经过 parseImportedProgram 内的逐时隙复算（零违规才会到达这里）
      const sim = simulate(check.input, check.actions);
      setImported({
        fileName: file.name,
        program: {
          kind: 'ok',
          input: check.input,
          actions: check.actions,
          slots: sim.snapshots,
          stats: { visited: 0, enqueued: 0, elapsedMs: 0 },
        },
      });
      setCursor(0);
    } else {
      // 文件记录的是无解案例：仅回填参数
      setImported(null);
    }
  };

  const curSnapshot = cursor === 0 ? null : slots[cursor - 1] ?? null;

  return (
    <div className="app">
      <header className="app-header">
        <h1>精密双轴脉冲程序规划器</h1>
        <p>
          在工艺走廊 |Y总·已走X − X总·已走Y| ≤ 上限 与两轴冷却节拍下，
          完整搜索最小时隙数、并按「双轴 → X → Y → 等待」取字典序最小程序；
          表格、坐标轨迹、偏差曲线与导出 JSON 始终对应同一程序，可逐时隙复算。
        </p>
      </header>

      <section className="panel" aria-label="参数输入">
        <h2>① 工艺参数</h2>
        <div className="field-grid">
          {FIELD_DEFS.map((f) => (
            <div key={f.key} className={`field${submittedErrors[f.key] ? ' has-error' : ''}`}>
              <label htmlFor={f.key}>{f.label}</label>
              <input
                id={f.key}
                inputMode="numeric"
                value={raw[f.key]}
                aria-invalid={!!submittedErrors[f.key]}
                onChange={(e) => setRaw((s) => ({ ...s, [f.key]: e.target.value }))}
              />
              {submittedErrors[f.key]
                ? <div className="field-error">{submittedErrors[f.key]}</div>
                : <div className="hint">{f.hint}</div>}
            </div>
          ))}
        </div>
        <div className="button-row">
          <button data-testid="btn-solve" onClick={runSolve} disabled={working}>
            {working ? '搜索进行中…' : '开始完整搜索'}
          </button>
          <button className="danger" data-testid="btn-cancel" onClick={worker.cancel} disabled={!working}>
            取消搜索
          </button>
          <button className="secondary" data-testid="btn-import" onClick={() => fileInputRef.current?.click()}>
            导入 JSON
          </button>
          <input
            ref={fileInputRef}
            data-testid="file-import"
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = '';
            }}
          />
          <button
            className="secondary"
            data-testid="btn-export"
            onClick={onExport}
            disabled={!program || stale || !!reverify?.violations.length}>
            导出当前程序 JSON
          </button>
        </div>
      </section>

      {globalErrors.length > 0 && (
        <div className="error-banner" data-testid="error-banner" role="alert">
          <strong>{globalErrors[0]}</strong>
          <ul>
            {Object.entries(submittedErrors).map(([k, m]) => (
              <li key={k}>{m}</li>
            ))}
            {globalErrors.slice(1).map((m, i) => <li key={i}>{m}</li>)}
          </ul>
        </div>
      )}

      {working && (
        <div className="panel" data-testid="searching-panel">
          <span className="badge busy">搜索中</span>
          <span className="muted" style={{ marginLeft: 10 }}>
            正在后台穷举可达状态（最坏约 1300 万状态），已发现{' '}
            <strong data-testid="progress-count">{worker.progressVisited.toLocaleString()}</strong> 个，
            可取消后调整参数重试……
          </span>
        </div>
      )}

      {worker.status === 'cancelled' && (
        <div className="panel muted">已取消本次搜索，未改动当前展示。</div>
      )}
      {worker.status === 'error' && (
        <div className="error-banner" role="alert">搜索失败：{worker.errorMessage}</div>
      )}

      {unsat && !working && (
        <section className="panel unsat-box" data-testid="unsat-panel" aria-label="无解说明">
          <h2>
            ② 无可行程序
            <span className="badge bad">UNSAT</span>
            {unsatStale && <span className="badge bad">参数已修改，需重新搜索</span>}
          </h2>
          <div className="reason">{unsat.reason}</div>
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            搜索统计：访问状态 {unsat.stats.visited.toLocaleString()} 个，
            耗时 {unsat.stats.elapsedMs} ms。
          </div>
        </section>
      )}

      {program && (
        <>
          <section className="panel" data-testid="result-panel" aria-label="求解结果">
            <h2>
              ② 程序结果
              {showingImported
                ? <span className="badge imported">导入程序 · 已逐时隙复算</span>
                : <span className="badge ok">完整搜索最优</span>}
              {stale && <span className="badge bad">参数已修改，需重新搜索/导入</span>}
              {reverify && reverify.violations.length === 0 && !stale && (
                <span className="badge ok">复算零违规</span>
              )}
              {reverify && reverify.violations.length > 0 && (
                <span className="badge bad">复算发现 {reverify.violations.length} 处问题</span>
              )}
            </h2>
            {showingImported && (
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                来源文件：{imported?.fileName}（该程序未必是最短程序，可点击「开始完整搜索」对比最优解）
              </div>
            )}
            <div className="summary-grid">
              <div className="stat"><div className="k">总时隙数</div><div className="v" data-testid="stat-total-slots">{program.actions.length}</div></div>
              <div className="stat"><div className="k">X 总步数</div><div className="v">{program.input.totalX}</div></div>
              <div className="stat"><div className="k">Y 总步数</div><div className="v">{program.input.totalY}</div></div>
              <div className="stat"><div className="k">冷却 X / Y</div><div className="v">{program.input.cooldownX} / {program.input.cooldownY}</div></div>
              <div className="stat"><div className="k">偏差上限</div><div className="v">±{program.input.tolerance}</div></div>
              <div className="stat"><div className="k">最大 |偏差|</div>
                <div className="v">{Math.max(0, ...slots.map((s) => s.absDeviation))}</div></div>
              {program.stats.visited > 0 && <>
                <div className="stat"><div className="k">访问状态</div><div className="v">{program.stats.visited.toLocaleString()}</div></div>
                <div className="stat"><div className="k">搜索耗时</div><div className="v">{program.stats.elapsedMs} ms</div></div>
              </>}
            </div>
            {reverify && reverify.violations.length > 0 && (
              <div className="error-banner" style={{ marginTop: 10 }}>
                <strong>逐时隙复算问题：</strong>
                <ul>{reverify.violations.slice(0, 20).map((v, i) => <li key={i}>{v}</li>)}</ul>
              </div>
            )}
          </section>

          <section className="panel" aria-label="时间游标">
            <h2>③ 时间游标复核</h2>
            <div className="cursor-row">
              <input
                type="range"
                data-testid="time-cursor"
                min={0}
                max={program.actions.length}
                value={cursor}
                aria-label="时间游标"
                onChange={(e) => setCursor(Number(e.target.value))}
              />
              <div className="cursor-readout" data-testid="cursor-readout">
                {curSnapshot ? (
                  <>
                    时隙 {curSnapshot.slot}/{program.actions.length} ·{' '}
                    <span className={`act-chip act-${curSnapshot.action}`}>
                      {ACTION_LABEL[curSnapshot.action]}
                    </span>{' '}
                    坐标 ({curSnapshot.xAfter}, {curSnapshot.yAfter}) ·
                    偏差 d = {program.input.totalY}×{curSnapshot.xAfter} −{' '}
                    {program.input.totalX}×{curSnapshot.yAfter} ={' '}
                    <strong>{curSnapshot.deviation}</strong>
                  </>
                ) : (
                  <>时隙 0（初始前缀）· 坐标 (0, 0) · 偏差 0</>
                )}
              </div>
            </div>
          </section>

          <section className="views-grid">
            <div className="panel">
              <h2>④ 坐标轨迹</h2>
              <TrajectoryChart input={program.input} slots={slots} cursor={cursor} />
            </div>
            <div className="panel">
              <h2>⑤ 偏差曲线</h2>
              <DeviationChart input={program.input} slots={slots} cursor={cursor} />
            </div>
          </section>

          <section className="panel" aria-label="脉冲表">
            <h2>
              ⑥ 脉冲表（点击任一行可移动时间游标）
              <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
                每个非初始前缀均满足走廊约束；间隔列显示动作前已连续经过的不含该轴时隙数
              </span>
            </h2>
            <PulseTable slots={slots} cursor={cursor} onCursor={setCursor} />
          </section>
        </>
      )}

      <section className="panel">
        <h2>说明：为什么必须完整搜索</h2>
        <ul className="muted" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
          <li>分别压缩两轴节拍（单发优先、有脉冲不等待）会越出工艺走廊：脉冲点偏离理论直线过多。</li>
          <li>逐时隙贪心可能得到非最短程序：例如总步数 (1,1)、上限 1 时贪心发出 X、Y 共 2 个时隙，
            而字典序最优解是 1 个时隙的「双轴」；「最小偏差」贪心则会在起点反复等待（等待保持偏差 0）。</li>
          <li>本工具的搜索以 BFS 穷举状态 (已走X, 已走Y, 两轴冷却计数)，先保证时隙数最少，
            再按 双轴 → X → Y → 等待 的扩展次序取字典序最小程序；无解时给出第一步越界数值或穷尽诊断。</li>
        </ul>
      </section>
    </div>
  );
}
