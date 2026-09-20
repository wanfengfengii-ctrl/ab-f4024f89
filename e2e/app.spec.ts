import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { solve, simulate } from '../src/core/solver';
import {
  ACTION_LABEL,
  type Action,
  type PlannerInput,
  type StepSnapshot,
} from '../src/core/types';
import { buildExportedProgram } from '../src/core/transfer';

async function setInput(page: Page, input: PlannerInput) {
  await page.locator('#cooldownY').waitFor();
  await page.fill('#totalX', String(input.totalX));
  await page.fill('#totalY', String(input.totalY));
  await page.fill('#cooldownX', String(input.cooldownX));
  await page.fill('#cooldownY', String(input.cooldownY));
  await page.fill('#tolerance', String(input.tolerance));
}

async function solveInBrowser(page: Page, input: PlannerInput) {
  await setInput(page, input);
  await page.getByTestId('btn-solve').click();
  await expect(page.getByTestId('stat-total-slots')).toBeVisible();
}

/** 读取脉冲表全部行（跳过表头） */
async function readTable(page: Page): Promise<string[][]> {
  return page.$$eval('[data-testid="pulse-table"] tbody tr', (rows) =>
    rows.map((r) =>
      [...r.querySelectorAll('td')].map((td) =>
        (td.textContent ?? '').trim(),
      ),
    ),
  );
}

test.describe('精密双轴脉冲规划器 —— 浏览器验收', () => {  test('页面加载：五个参数输入与操作按钮齐全', async ({ page }) => {
    await page.goto('/');
    for (const id of ['totalX', 'totalY', 'cooldownX', 'cooldownY', 'tolerance']) {
      await expect(page.locator(`#${id}`)).toBeVisible();
    }
    await expect(page.getByTestId('btn-solve')).toBeVisible();
    await expect(page.getByTestId('btn-import')).toBeVisible();
    await expect(page.getByTestId('btn-export')).toBeVisible();
  });

  test('冷却 1 手工用例：XY、等待、X，表格/曲线/轨迹同源且可逐时隙复算', async ({ page }) => {
    const input: PlannerInput = { totalX: 2, totalY: 1, cooldownX: 1, cooldownY: 0, tolerance: 1000 };
    const expected = solve(input);
    expect(expected.kind).toBe('ok');
    if (expected.kind !== 'ok') return;

    await page.goto('/');
    await solveInBrowser(page, input);

    await expect(page.getByTestId('stat-total-slots')).toHaveText('3');
    await expect(page.getByText('复算零违规')).toBeVisible();

    const rows = await readTable(page);
    expect(rows).toHaveLength(3);
    // 节点侧用同一核心算法逐时隙复算，浏览器表格必须逐格一致
    const sim: StepSnapshot[] = expected.slots;
    rows.forEach((cells, i) => {
      const s = sim[i];
      expect(cells[0]).toBe(String(s.slot));
      expect(cells[1]).toBe(ACTION_LABEL[s.action]);
      expect(cells[4]).toBe(String(s.xAfter));
      expect(cells[5]).toBe(String(s.yAfter));
      expect(cells[6]).toBe(String(s.deviation));
      expect(cells[7]).toBe(String(s.absDeviation));
      expect(cells[8]).toBe(String(s.xGapBefore));
      expect(cells[9]).toBe(String(s.yGapBefore));
    });

    // 冷却事实复核：第 3 时隙的 X 之前恰有 1 个不含 X 的时隙（等待）
    expect(rows[2][8]).toBe('1');

    // 两张图存在
    await expect(page.getByTestId('trajectory-chart')).toBeVisible();
    await expect(page.getByTestId('deviation-chart')).toBeVisible();

    // 时间游标：移动到第 2 时隙，读数为 等待、坐标 (1,1)、偏差 1·1 − 2·1 = −1
    await page.getByTestId('time-cursor').fill('2');
    const readout = page.getByTestId('cursor-readout');
    await expect(readout).toContainText('时隙 2/3');
    await expect(readout).toContainText('(1, 1)');
    // 运算符号是 Unicode 减号 −，偏差数值由 JS 数字渲染为 ASCII -1
    await expect(readout).toContainText('-1');
    // 表格对应行高亮
    await expect(page.locator('tr.cursor-row-active')).toHaveCount(1);
    expect(await page.locator('tr.cursor-row-active td').first().textContent()).toBe('2');

    // 点击表格第 3 行，游标跟随
    await page.getByTestId('pulse-table').locator('tbody tr').nth(2).click();
    await expect(readout).toContainText('时隙 3/3');
    await expect(readout).toContainText('(2, 1)');
    await expect(readout).toContainText('0');
  });

  test('贪心反例 (1,1,上限1)：最优为 1 时隙双轴', async ({ page }) => {
    const input: PlannerInput = { totalX: 1, totalY: 1, cooldownX: 0, cooldownY: 0, tolerance: 1 };
    await page.goto('/');
    await solveInBrowser(page, input);
    await expect(page.getByTestId('stat-total-slots')).toHaveText('1');
    const rows = await readTable(page);
    expect(rows[0][1]).toBe('双轴');
  });

  test('无解（第一步必越界）：显示具体数值原因', async ({ page }) => {
    const input: PlannerInput = { totalX: 6, totalY: 2, cooldownX: 0, cooldownY: 0, tolerance: 1 };
    await page.goto('/');
    await setInput(page, input);
    await page.getByTestId('btn-solve').click();
    // 此场景不出现结果面板，只出现无解面板
    await expect(page.getByTestId('unsat-panel')).toBeVisible();
    await expect(page.getByTestId('unsat-panel')).toContainText('第一步脉冲必然越界');
    await expect(page.getByTestId('unsat-panel')).toContainText('2');
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
  });

  test('无解（走廊中途封闭）：穷尽诊断含最远位置', async ({ page }) => {
    const input: PlannerInput = { totalX: 1, totalY: 4, cooldownX: 0, cooldownY: 0, tolerance: 1 };
    await page.goto('/');
    await setInput(page, input);
    await page.getByTestId('btn-solve').click();
    await expect(page.getByTestId('unsat-panel')).toBeVisible();
    await expect(page.getByTestId('unsat-panel')).toContainText('穷尽');
    await expect(page.getByTestId('unsat-panel')).toContainText('(0, 1)');
  });

  test('非法输入：一次标出全部字段问题并清除旧结果', async ({ page }) => {
    await page.goto('/');
    // 先求出一个合法结果
    await solveInBrowser(page, { totalX: 3, totalY: 3, cooldownX: 0, cooldownY: 0, tolerance: 0 });
    await expect(page.getByTestId('result-panel')).toBeVisible();

    // 制造 5 个问题：空、小数、超界、负数、非数字
    await page.fill('#totalX', '');
    await page.fill('#totalY', '1.5');
    await page.fill('#cooldownX', '9');
    await page.fill('#cooldownY', '-1');
    await page.fill('#tolerance', 'abc');
    await page.getByTestId('btn-solve').click();

    const banner = page.getByTestId('error-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('已清除上一次结果');
    await expect(banner.locator('li')).toHaveCount(5);
    // 旧结果确已消失
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
    // 五个输入框均被标记非法
    await expect(page.locator('.field.has-error')).toHaveCount(5);
    // 导出按钮在无结果时禁用
    await expect(page.getByTestId('btn-export')).toBeDisabled();
  });

  test('导出 JSON 与界面同一程序，且时间线逐时隙可独立复算', async ({ page }) => {
    const input: PlannerInput = { totalX: 7, totalY: 5, cooldownX: 2, cooldownY: 1, tolerance: 3 };
    const expected = solve(input);
    expect(expected.kind).toBe('ok');
    if (expected.kind !== 'ok') return;

    await page.goto('/');
    await solveInBrowser(page, input);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('btn-export').click(),
    ]);
    const stream = await download.createReadStream();
    let text = '';
    for await (const chunk of stream) text += chunk;
    const json = JSON.parse(text);

    expect(json.format).toBe('dual-axis-pulse-program/v1');
    expect(json.input).toEqual(input);
    expect(json.result.solvable).toBe(true);
    expect(json.result.totalSlots).toBe(expected.actions.length);
    expect(json.result.actions).toEqual(expected.actions);
    expect(json.result.timeline).toHaveLength(expected.actions.length);

    // 独立复算导出的时间线：字段一致、全程不违规
    const independent = simulate(input, json.result.actions as Action[]);
    expect(independent.violations).toEqual([]);
    expect(json.result.timeline).toEqual(independent.snapshots);

    // 界面表格与导出时间线同源
    const rows = await readTable(page);
    (json.result.timeline as StepSnapshot[]).forEach((s, i) => {
      expect(rows[i][6]).toBe(String(s.deviation));
      expect(rows[i][4]).toBe(String(s.xAfter));
      expect(rows[i][5]).toBe(String(s.yAfter));
    });
  });

  test('导入合法 JSON：回填参数并展示逐时隙复算结果', async ({ page }, testInfo) => {
    const input: PlannerInput = { totalX: 4, totalY: 3, cooldownX: 1, cooldownY: 2, tolerance: 2 };
    const result = solve(input);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const json = buildExportedProgram(result);
    const path = testInfo.outputPath('program.json');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, JSON.stringify(json));

    await page.goto('/');
    await page.getByTestId('file-import').setInputFiles(path);

    await expect(page.getByTestId('result-panel')).toBeVisible();
    await expect(page.locator('body')).toContainText('导入程序 · 已逐时隙复算');
    await expect(page.getByTestId('stat-total-slots')).toHaveText(String(result.actions.length));
    // 参数回填
    expect(await page.inputValue('#totalX')).toBe('4');
    expect(await page.inputValue('#cooldownY')).toBe('2');
    const rows = await readTable(page);
    expect(rows).toHaveLength(result.actions.length);
  });

  test('导入篡改/损坏文件：一次列出全部问题且不展示结果', async ({ page }, testInfo) => {
    const path = testInfo.outputPath('bad.json');
    const { writeFileSync } = await import('node:fs');
    // 非法 JSON 文本
    writeFileSync(path, '{ not json');
    await page.goto('/');
    await page.getByTestId('file-import').setInputFiles(path);
    await expect(page.getByTestId('error-banner')).toContainText('不是合法 JSON');
    await expect(page.getByTestId('result-panel')).toHaveCount(0);

    // 结构合法但程序违反冷却与走廊
    const tampered = {
      format: 'dual-axis-pulse-program/v1',
      generatedAt: new Date().toISOString(),
      input: { totalX: 3, totalY: 3, cooldownX: 3, cooldownY: 3, tolerance: 0 },
      result: { solvable: true, totalSlots: 4, actions: ['XY', 'XY', 'X', 'Y'], timeline: [] },
    };
    writeFileSync(path, JSON.stringify(tampered));
    await page.getByTestId('file-import').setInputFiles(path);
    const banner = page.getByTestId('error-banner');
    await expect(banner).toContainText('导入失败');
    await expect(banner).toContainText('冷却');
    await expect(banner).toContainText('偏差');
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
  });

  test('重搜索可即时取消：取消后不出结果，再搜索仍能正常完成', async ({ page }) => {
    await page.goto('/');
    // 最坏状态空间：大步数 + 冷却 8 + 宽走廊，约 1300 万状态、数秒
    await setInput(page, { totalX: 400, totalY: 400, cooldownX: 8, cooldownY: 8, tolerance: 10 ** 12 });
    await page.getByTestId('btn-solve').click();
    await expect(page.getByTestId('btn-cancel')).toBeEnabled();
    await page.getByTestId('btn-cancel').click();
    await expect(page.locator('body')).toContainText('已取消本次搜索');
    await expect(page.getByTestId('result-panel')).toHaveCount(0);
    await expect(page.getByTestId('unsat-panel')).toHaveCount(0);

    // 取消后用一个小输入重新搜索，应正常得到结果
    await solveInBrowser(page, { totalX: 1, totalY: 1, cooldownX: 0, cooldownY: 0, tolerance: 1 });
    await expect(page.getByTestId('stat-total-slots')).toHaveText('1');
  });

  test('参数边界：1~400 步、冷却 0~8、上限 0 均可工作；400×400/冷却8 完整搜索成功', async ({ page }) => {
    await page.goto('/');
    // 上限 0、不等步数：无解或有解都应明确（此处 X=Y 有对角线解）
    const diag: PlannerInput = { totalX: 400, totalY: 400, cooldownX: 0, cooldownY: 0, tolerance: 0 };
    const t0 = Date.now();
    await solveInBrowser(page, diag);
    await expect(page.getByTestId('stat-total-slots')).toHaveText('400');
    expect(Date.now() - t0).toBeLessThan(30_000);
    const rows = await readTable(page);
    expect(rows).toHaveLength(400);

    // 冷却 8 的最大节拍情形（最坏状态空间，Worker 中完整搜索）
    const heavy: PlannerInput = { totalX: 400, totalY: 400, cooldownX: 8, cooldownY: 8, tolerance: 10 ** 12 };
    await solveInBrowser(page, heavy);
    await expect(page.getByTestId('stat-total-slots')).toHaveText(String(400 + 399 * 8));
  });
});
