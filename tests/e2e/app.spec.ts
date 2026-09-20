import { expect, Page, test } from '@playwright/test';

async function setField(page: Page, key: string, value: string) {
  await page.getByTestId(`input-${key}`).fill(value);
}

test.describe('双轴脉冲平台浏览器验收', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('综合成功：统计、程序串、脉冲表逐时隙一致且终态正确', async ({ page }) => {
    await page.getByTestId('btn-solve').click();

    await expect(page.getByTestId('stat-slots')).toHaveText(/\d+/);
    const strip = page.getByTestId('program-strip');
    await expect(strip).toBeVisible();
    const progText = (await strip.innerText()).replace(/\s/g, '');
    expect(progText.length).toBeGreaterThan(0);
    expect(progText).toMatch(/^[BXYW]+$/);

    // 表格行数 = 总时隙数；每行走廊检查均为 ✓；末行到达目标 (12,7)
    const rows = page.locator('.table-wrap tbody tr');
    const statSlots = Number((await page.getByTestId('stat-slots').innerText()).trim());
    await expect(rows).toHaveCount(statSlots);
    expect(await page.locator('.table-wrap tbody tr td:nth-child(8)').allInnerTexts()).not.toContain('✗');

    const lastRow = rows.last();
    await expect(lastRow.locator('td:nth-child(5)')).toHaveText('12');
    await expect(lastRow.locator('td:nth-child(6)')).toHaveText('7');
  });

  test('确定性小样：最短且字典序最小程序为 BX', async ({ page }) => {
    await setField(page, 'totalX', '2');
    await setField(page, 'totalY', '1');
    await setField(page, 'gapX', '0');
    await setField(page, 'gapY', '0');
    await setField(page, 'tolerance', '8');
    await page.getByTestId('btn-solve').click();

    await expect(page.getByTestId('program-strip')).toHaveText('BX');
    await expect(page.getByTestId('stat-slots')).toHaveText('2');
  });

  test('非法输入：一次性标出全部问题并清除旧结果', async ({ page }) => {
    // 先综合出一个有效结果
    await page.getByTestId('btn-solve').click();
    await expect(page.getByTestId('stat-slots')).toBeVisible();

    // 再制造三个非法字段
    await setField(page, 'totalX', '0');
    await setField(page, 'gapX', '9');
    await setField(page, 'tolerance', 'abc');
    await page.getByTestId('btn-solve').click();

    const invalidFields = page.locator('.field.invalid');
    await expect(invalidFields).toHaveCount(3);
    const xField = page.locator('.field').filter({ has: page.getByTestId('input-totalX') });
    await expect(xField.locator('.err')).toContainText(/1 至 400/);
    // 旧结果必须被清除
    await expect(page.getByTestId('stat-slots')).toHaveCount(0);
  });

  test('无解：明确显示原因（走廊不可达）', async ({ page }) => {
    await setField(page, 'totalX', '2');
    await setField(page, 'totalY', '1');
    await setField(page, 'gapX', '0');
    await setField(page, 'gapY', '0');
    await setField(page, 'tolerance', '0');
    await page.getByTestId('btn-solve').click();

    const box = page.getByTestId('infeasible');
    await expect(box).toBeVisible();
    await expect(box).toContainText('无解');
    await expect(box).toContainText('偏差');
    await expect(page.getByTestId('stat-slots')).toHaveCount(0);
  });

  test('时间游标：滑动后坐标、偏差、表格高亮逐时隙对应', async ({ page }) => {
    await page.getByTestId('btn-solve').click();
    const slider = page.getByTestId('cursor-slider');
    await slider.fill('5');
    await expect(page.getByTestId('cursor-pos')).toHaveText(/^时隙 5\/\d+/);

    // 第 5 行高亮，且说明文字中的累计坐标与该行一致
    const activeRow = page.locator('.table-wrap tbody tr.active');
    await expect(activeRow).toHaveCount(1);
    await expect(activeRow.locator('td:nth-child(1)')).toHaveText('5');
    const x = await activeRow.locator('td:nth-child(5)').innerText();
    const y = await activeRow.locator('td:nth-child(6)').innerText();
    await expect(page.locator('.slider-row + .muted')).toContainText(`(${x}, ${y})`);

    // 两张 SVG 图均已渲染
    await expect(page.locator('svg')).toHaveCount(2);

    // 步进到末尾
    await page.getByTestId('cursor-next').click();
    await expect(page.locator('.table-wrap tbody tr.active td:nth-child(1)')).toHaveText('6');
  });

  test('导出 JSON 再导入：程序、统计完全一致且可逐时隙复算', async ({ page }) => {
    await page.getByTestId('btn-solve').click();
    const progBefore = (await page.getByTestId('program-strip').innerText()).replace(/\s/g, '');
    const slotsBefore = (await page.getByTestId('stat-slots').innerText()).trim();

    await page.getByTestId('btn-export').click();
    const io = page.getByTestId('io-text');
    const jsonText = await io.inputValue();
    const doc = JSON.parse(jsonText);
    expect(doc.app).toBe('dual-axis-pulse-planner');
    expect(doc.program).toBe(progBefore);
    expect(doc.stats.totalSlots).toBe(Number(slotsBefore));

    await page.getByTestId('btn-import').click();
    await expect(page.getByTestId('program-strip')).toHaveText(progBefore);
    await expect(page.getByTestId('stat-slots')).toHaveText(slotsBefore);
    // 参数也已回填
    await expect(page.getByTestId('input-totalX')).toHaveValue('12');
  });

  test('导入非法/不可复算程序：一次性报错并清除旧结果', async ({ page }) => {
    await page.getByTestId('btn-solve').click();
    const bad = JSON.stringify({
      app: 'dual-axis-pulse-planner',
      params: { totalX: 2, totalY: 1, gapX: 2, gapY: 0, tolerance: 100 },
      program: 'XXYW',
      stats: { totalSlots: 4, pulseSlots: 3, waitSlots: 1 },
    });
    await page.getByTestId('io-text').fill(bad);
    await page.getByTestId('btn-import').click();

    const errBox = page.getByTestId('io-errors');
    await expect(errBox).toBeVisible();
    await expect(errBox).toContainText('冷却');
    // 旧结果被清除
    await expect(page.getByTestId('stat-slots')).toHaveCount(0);

    // JSON 语法错误：明确报解析失败
    await page.getByTestId('io-text').fill('{not json');
    await page.getByTestId('btn-import').click();
    await expect(page.getByTestId('io-errors')).toContainText('JSON 解析失败');
  });
});
