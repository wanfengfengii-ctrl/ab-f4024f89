# 精密双轴脉冲程序规划器

纯前端（TypeScript + React + Vite）双轴脉冲程序完整搜索与复核工具。无任何业务后端：
搜索在浏览器 **Web Worker** 中完成，站点仅由 nginx 托管静态文件。

## 解决的问题

精密双轴平台以离散脉冲逼近直线路径时：

- 分别压缩两轴节拍会越出工艺走廊（脉冲点偏离理论直线过多）；
- 逐时隙贪心可能得到**非最短程序**——例如总步数 (1,1)、偏差上限 1 时，
  「单发优先、有脉冲不等待」的贪心发出 `X、Y` 共 2 个时隙，
  而最优解是 1 个时隙的「双轴」；「最小偏差」贪心则会在起点反复等待
  （等待保持偏差为 0，形成循环）。

因此本工具做**完整搜索**：

1. **最小时隙数**优先；
2. 时隙数相同时，按 `双轴 → X → Y → 等待` 的动作次序取**字典序最小**程序。

### 约束（逐时隙复算口径）

- 每个时隙只能下发四种动作之一：`XY`（双轴）、`X`、`Y`、`WAIT`（等待）；
- 相邻两个含同一轴脉冲的时隙之间，至少隔开该轴规定数量的**不含该轴**时隙
  （X/Y 冷却间隔各 0~8）；
- 每个非初始前缀均须满足工艺走廊：

  ```
  | Y总步数 × 已走X − X总步数 × 已走Y | ≤ 偏差上限
  ```

- X、Y 总步数各 1~400，偏差上限为非负整数。

## 算法

状态编码为 `(已走X, 已走Y, gx, gy)`，其中 `gx/gy` 是距上一个含该轴脉冲时隙
已经经过的「不含该轴」时隙数，达到冷却间隔后**封顶**（封顶是完备的等价合并：
一旦就绪，继续等待不改变任何动作的合法性）。起始状态的冷却计数等于规定间隔，
即首个脉冲随时可发。

- **BFS** 按层扩展保证时隙数最少；
- 父节点按到达先后出队、子节点严格按 `双轴、X、Y、等待` 生成，
  故目标第一次被访问时的路径即最短且字典序最小（见 `src/core/solver.ts`）；
- 最坏状态空间约 401×401×9×9 ≈ 1300 万，使用 `Int32Array/Uint8Array`
  紧凑存储（约 130 MB），最坏输入在 Worker 中约数秒完成，可随时取消。

无解时区分两类原因：

1. **第一步即越界**：直接列出发 X / 发 Y / 双轴三种第一步的偏差数值并提前返回；
2. **走廊中途封闭**：穷尽全部可达状态后，报告访问状态数与可达最远位置。

## 界面复核（同一程序，四种视图）

求解成功后，脉冲表、坐标轨迹图、偏差曲线图、时间游标读数与导出的 JSON
**全部派生自同一个程序对象**，并且：

- 渲染时与导出前都会调用独立的 `simulate()` 逐时隙复算（冷却、步数、偏差）；
- 拖动「时间游标」（0 = 初始前缀）可复核任一时隙后的坐标、偏差与冷却间隔；
- 点击脉冲表任一行可反向移动游标。

## 本地开发

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # vitest 单测（含独立 DFS 对拍：最短性 + 字典序 + 可解性）
npm run build      # tsc + vite 产物到 dist/
npm run preview
npx playwright test   # 浏览器验收（自动 build + preview）
```

## Docker 运行

```bash
cp .env.example .env   # 可选：修改宿主机端口 HOST_PORT（默认 8080）
docker compose build
docker compose up -d
# 健康检查：容器内 wget /health；宿主机访问
curl http://localhost:8080/health      # -> ok
```

- 宿主机端口可配置：`.env` 中 `HOST_PORT`（映射到容器固定 80 端口）；
- `web` 服务带 `healthcheck`（nginx 提供 `/health` 端点）。

## verify 服务（浏览器验收）

```bash
docker compose run --rm verify
```

该服务基于预装 Chromium 的 Playwright 镜像，等待 `web` 健康后在真实浏览器中
执行 10 项端到端验收（参数编辑、多错误一次标出、最短/字典序程序、两类无解原因、
时间游标联动、导出 JSON 逐时隙复算、合法/损坏 JSON 导入、400×400 与冷却 8 的
边界大输入）。可通过 `BASE_URL` 指向其他部署：

```bash
BASE_URL=https://your-host docker compose run --rm verify
```

## 导入 / 导出 JSON 格式

```json
{
  "format": "dual-axis-pulse-program/v1",
  "generatedAt": "2026-09-20T00:00:00.000Z",
  "input": { "totalX": 2, "totalY": 1, "cooldownX": 1, "cooldownY": 0, "tolerance": 1000 },
  "result": {
    "solvable": true,
    "totalSlots": 3,
    "actions": ["XY", "WAIT", "X"],
    "timeline": [
      {
        "slot": 1, "action": "XY",
        "xAfter": 1, "yAfter": 1,
        "deviation": -1, "absDeviation": 1,
        "xGapBefore": 1, "yGapBefore": 0
      }
    ],
    "stats": { "visited": 12, "enqueued": 12, "elapsedMs": 0.12 }
  }
}
```

导入时会重新做结构/范围校验，并对动作序列执行独立逐时隙复算；
冷却违规、偏差越界、超步数、总量不符等问题会一次全部列出，且不展示结果。

## 目录结构

```
src/core/
  types.ts        领域类型与动作次序
  validation.ts   输入校验（一次标出全部问题）与第一步越界诊断
  solver.ts       BFS 完整搜索 + simulate 逐时隙独立复算
  solver.worker.ts  Worker 包装（可取消）
  transfer.ts     导出 JSON 构造与导入解析/复算
src/charts.tsx    坐标轨迹 / 偏差曲线 / 脉冲表（同源派生）
src/App.tsx       参数面板、游标、结果/无解/错误视图、导入导出
e2e/app.spec.ts   Playwright 浏览器验收
```
