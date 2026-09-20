import { useMemo, useRef, useState } from 'react';
import { PARAM_FIELDS, PARAM_LABEL, Params, ParamKey, validateParams } from './core/validation';
import { ACTION_NAME, PrefixState, ProgramChar } from './core/types';
import { SolveOutcome } from './core/scheduler';
import { replay } from './core/replay';
import { ExportDoc, importDoc } from './core/io';
import TrajectoryChart from './components/TrajectoryChart';
import DeviationChart from './components/DeviationChart';
import PulseTable from './components/PulseTable';

interface Result {
  params: Params;
  outcome: Extract<SolveOutcome, { kind: 'feasible' }>;
  states: PrefixState[];
  program: ProgramChar[];
}

const DEFAULTS: Record<ParamKey, string> = {
  totalX: '12',
  totalY: '7',
  gapX: '1',
  gapY: '2',
  tolerance: '6',
};

let reqId = 0;

export default function App() {
  const [raw, setRaw] = useState<Record<ParamKey, string>>(DEFAULTS);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ParamKey, string>>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [infeasible, setInfeasible] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [ioText, setIoText] = useState('');
  const [ioErrors, setIoErrors] = useState<string[]>([]);
  const [ioOk, setIoOk] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const getWorker = () => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./core/solve.worker.ts', import.meta.url), { type: 'module' });
    }
    return workerRef.current;
  };

  const runSolve = (params: Params) => {
    setBusy(true);
    setInfeasible(null);
    const id = ++reqId;
    const w = getWorker();
    w.onmessage = (e: MessageEvent<{ id: number; outcome: SolveOutcome }>) => {
      if (e.data.id !== id) return; // 过期响应（用户已再次提交）
      setBusy(false);
      const oc = e.data.outcome;
      if (oc.kind === 'infeasible') {
        setResult(null);
        setInfeasible(oc.reason);
        setCursor(0);
        return;
      }
      const chk = replay(oc.program, params);
      if (!chk.ok) {
        // UI 侧再独立复算一次，确保表格/轨迹/导出全部来自同一可信程序
        setResult(null);
        setInfeasible(`内部错误：综合结果复算失败（${chk.reason}）`);
        return;
      }
      setResult({ params, outcome: oc, states: chk.states, program: oc.program });
      setCursor(0);
      setInfeasible(null);
    };
    w.postMessage({ id, params });
  };

  // 点击“综合”：非法输入时一次性标出全部字段问题，并清除旧结果
  const onSynthesize = () => {
    const v = validateParams(raw);
    if (!v.value) {
      setFieldErrors(v.errors);
      setResult(null);
      setInfeasible(null);
      setCursor(0);
      return;
    }
    setFieldErrors({});
    runSolve(v.value);
  };

  const setField = (k: ParamKey, val: string) => {
    setRaw((r) => ({ ...r, [k]: val }));
    if (fieldErrors[k]) setFieldErrors((e) => ({ ...e, [k]: undefined }));
  };

  const exportDoc: ExportDoc | null = useMemo(() => {
    if (!result) return null;
    let pulse = 0;
    for (const a of result.program) if (a !== 'W') pulse++;
    return {
      app: 'dual-axis-pulse-planner',
      version: 1,
      exportedAt: new Date().toISOString(),
      params: result.params,
      program: result.program.join(''),
      stats: { totalSlots: result.program.length, pulseSlots: pulse, waitSlots: result.program.length - pulse },
    };
  }, [result]);

  const onShowExport = () => {
    if (!exportDoc) return;
    setIoText(JSON.stringify(exportDoc, null, 2));
    setIoErrors([]);
    setIoOk(null);
  };

  const onDownload = () => {
    if (!exportDoc) return;
    const blob = new Blob([JSON.stringify(exportDoc, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pulse-program-${exportDoc.params.totalX}x${exportDoc.params.totalY}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // 导入：所有问题一次性列出；失败时清除旧结果（与“非法输入清除旧结果”一致）
  const onImport = () => {
    const r = importDoc(ioText);
    if (!r.ok || !r.doc) {
      setIoErrors(r.errors);
      setIoOk(null);
      setResult(null);
      setInfeasible(null);
      setCursor(0);
      return;
    }
    setIoErrors([]);
    setIoOk('导入并复算通过，已载入该程序。');
    const { params, program } = r.doc;
    const chk = replay(program, params);
    const fake: Result = {
      params,
      program,
      states: chk.states!,
      outcome: {
        kind: 'feasible',
        program,
        totalSlots: program.length,
        pulseSlots: program.filter((a) => a !== 'W').length,
        waitSlots: program.filter((a) => a === 'W').length,
        diagnostics: { exploredStates: -1, elapsedMs: 0, bfsDepth: -1 },
      },
    };
    setResult(fake);
    setInfeasible(null);
    setCursor(0);
    setRaw({
      totalX: String(params.totalX),
      totalY: String(params.totalY),
      gapX: String(params.gapX),
      gapY: String(params.gapY),
      tolerance: String(params.tolerance),
    });
    setFieldErrors({});
  };

  const onFile = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => setIoText(String(reader.result ?? ''));
    reader.readAsText(f);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>精密双轴脉冲平台 · 程序综合器</h1>
        <div className="sub">
          每时隙仅发 双轴 / X / Y / 等待；先最小化时隙数，再按「双轴 &lt; X &lt; Y &lt; 等待」取字典序最小程序。所有视图均由同一程序逐时隙复算得到。
        </div>
      </header>

      <div className="layout">
        {/* 左栏：参数 + 导入导出 */}
        <div>
          <section className="panel" aria-label="参数输入">
            <h2>① 工艺参数</h2>
            {PARAM_FIELDS.map((k) => (
              <div key={k} className={`field ${fieldErrors[k] ? 'invalid' : ''}`}>
                <label>
                  <span>{PARAM_LABEL[k]}</span>
                  {k === 'totalX' || k === 'totalY' ? (
                    <span>1–400 步</span>
                  ) : k === 'tolerance' ? (
                    <span>≥ 0 整数</span>
                  ) : (
                    <span>0–8 个时隙</span>
                  )}
                </label>
                <input
                  data-testid={`input-${k}`}
                  value={raw[k]}
                  inputMode="numeric"
                  onChange={(e) => setField(k, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && onSynthesize()}
                />
                {fieldErrors[k] && <div className="err">{fieldErrors[k]}</div>}
              </div>
            ))}
            <div className="btn-row">
              <button className="primary" data-testid="btn-solve" onClick={onSynthesize} disabled={busy}>
                {busy ? '综合中…' : '综合程序'}
              </button>
              <button
                className="ghost"
                onClick={() => {
                  setRaw(DEFAULTS);
                  setFieldErrors({});
                }}
              >
                恢复示例
              </button>
            </div>
            <div className="muted" style={{ marginTop: 8 }}>
              冷却语义：相邻两个含同一轴脉冲的时隙之间，至少隔开该轴规定数量的“不含该轴”时隙（等待计入间隔）。
            </div>
          </section>

          <section className="panel import-export" aria-label="导入导出">
            <h2>④ 导入 / 导出 JSON</h2>
            <div className="btn-row" style={{ marginBottom: 8 }}>
              <button data-testid="btn-export" onClick={onShowExport} disabled={!result}>
                生成导出 JSON
              </button>
              <button onClick={onDownload} disabled={!result}>
                下载文件
              </button>
              <button data-testid="btn-import" className="primary" onClick={onImport} disabled={!ioText.trim()}>
                导入并复算
              </button>
              <button className="ghost" onClick={() => fileRef.current?.click()}>
                选择文件…
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
              />
            </div>
            <textarea
              data-testid="io-text"
              value={ioText}
              onChange={(e) => setIoText(e.target.value)}
              placeholder="点击“生成导出 JSON”，或在此粘贴 / 选择此前导出的 JSON 后点击“导入并复算”。"
            />
            {ioErrors.length > 0 && (
              <div className="alert error" data-testid="io-errors">
                导入被拒绝，发现 {ioErrors.length} 个问题：
                <ul>
                  {ioErrors.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            {ioOk && <div className="alert ok">{ioOk}</div>}
          </section>
        </div>

        {/* 右栏：结果 */}
        <div>
          {infeasible && (
            <section className="panel">
              <h2>综合结果</h2>
              <div className="alert error" data-testid="infeasible">
                {infeasible}
              </div>
            </section>
          )}

          {!result && !infeasible && (
            <section className="panel">
              <div className="empty" data-testid="empty">
                填写左侧参数后点击「综合程序」。
                <br />
                搜索将穷举冷却状态空间（完整搜索，非贪心），输出时隙最短且字典序最小的唯一程序。
              </div>
            </section>
          )}

          {result && (
            <>
              <section className="panel" aria-label="综合结果">
                <h2>② 综合结果（程序字符串）</h2>
                <div className="stats">
                  <div className="stat">
                    <div className="num" data-testid="stat-slots">{result.outcome.totalSlots}</div>
                    <div className="lbl">总时隙数（最小）</div>
                  </div>
                  <div className="stat">
                    <div className="num">{result.outcome.pulseSlots}</div>
                    <div className="lbl">脉冲时隙</div>
                  </div>
                  <div className="stat">
                    <div className="num">{result.outcome.waitSlots}</div>
                    <div className="lbl">等待时隙</div>
                  </div>
                  <div className="stat">
                    <div className="num">
                      {result.params.totalX} / {result.params.totalY}
                    </div>
                    <div className="lbl">X / Y 总步数</div>
                  </div>
                </div>
                <div className="legend">
                  <span><i className="dot" style={{ background: '#b48cff' }} />B 双轴</span>
                  <span><i className="dot" style={{ background: '#4da3ff' }} />X 仅X</span>
                  <span><i className="dot" style={{ background: '#35d07f' }} />Y 仅Y</span>
                  <span><i className="dot" style={{ background: '#8a97ab' }} />W 等待</span>
                </div>
                <div className="program-strip" data-testid="program-strip">
                  {result.program.map((a, i) => (
                    <span key={i} className={`chip ch-${a} ${i + 1 === cursor ? 'cur' : ''}`}>
                      {a}
                    </span>
                  ))}
                </div>
                {result.outcome.diagnostics.exploredStates >= 0 && (
                  <div className="diag">
                    完整搜索：后向 BFS 标记 {result.outcome.diagnostics.exploredStates.toLocaleString()} 个冷却状态，
                    用时 {result.outcome.diagnostics.elapsedMs.toFixed(1)} ms，BFS 最短距离 = {result.outcome.diagnostics.bfsDepth} 时隙。
                  </div>
                )}
              </section>

              <section className="panel" aria-label="时间游标复核">
                <h2>③ 时间游标复核</h2>
                <div className="slider-row">
                  <button data-testid="cursor-prev" onClick={() => setCursor((c) => Math.max(0, c - 1))}>
                    ‹ 前一时隙
                  </button>
                  <input
                    type="range"
                    data-testid="cursor-slider"
                    min={0}
                    max={result.program.length}
                    value={cursor}
                    onChange={(e) => setCursor(Number(e.target.value))}
                  />
                  <button data-testid="cursor-next" onClick={() => setCursor((c) => Math.min(result.program.length, c + 1))}>
                    后一时隙 ›
                  </button>
                  <span className="pos" data-testid="cursor-pos">
                    时隙 {cursor}/{result.program.length}
                  </span>
                </div>
                <div className="muted">
                  {cursor === 0
                    ? '初始前缀：(x, y) = (0, 0)，尚未发出任何脉冲。'
                    : `时隙 ${cursor} 动作：${ACTION_NAME[result.program[cursor - 1]]}；累计 (x, y) = (${result.states[cursor].x}, ${result.states[cursor].y})，偏差 D = ${result.states[cursor].deviation}（|D| ≤ ${result.params.tolerance}）。`}
                </div>

                <div className="viz-grid" style={{ marginTop: 10 }}>
                  <TrajectoryChart params={result.params} states={result.states} cursor={cursor} />
                  <DeviationChart params={result.params} states={result.states} cursor={cursor} />
                </div>

                <div style={{ marginTop: 12 }}>
                  <PulseTable params={result.params} states={result.states} cursor={cursor} />
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
