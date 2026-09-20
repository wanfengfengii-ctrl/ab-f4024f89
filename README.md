# 精密双轴脉冲平台 · 程序综合器

纯前端（TypeScript + React + Vite）应用，无任何业务后端。给定两轴总步数、两轴冷却间隔与偏差上限，
**完整搜索**出时隙最短、再按 `双轴(B) < X < Y < 等待(W)` 字典序最小的脉冲程序，并用时间游标复核
坐标轨迹、脉冲表与偏差曲线；结果可导出 / 导入 JSON 并逐时隙复算。

## 1. 问题模型

每时隙只能发四种动作之一：

| 动作 | 含义 | X 增量 | Y 增量 |
|----|----|----|----|
| `B` | 双轴同时脉冲 | 1 | 1 |
| `X` | 仅 X 脉冲 | 1 | 0 |
| `Y` | 仅 Y 脉冲 | 0 | 1 |
| `W` | 等待 | 0 | 0 |

- **冷却约束**：相邻两个含 X 脉冲的时隙之间，至少隔开 `gapX` 个“不含 X”的时隙；Y 同理（等待计入间隔）。
- **工艺走廊**：每个非初始前缀 `(x,y)` 必须满足 `| TY·x − TX·y | ≤ tolerance`。
- **终态**：程序在累计坐标到达 `(TX, TY)` 的时隙结束（恰好不超发；终态允许冷却计数器非零——拖尾等待必不最短）。
- **优化目标**：先最小化时隙数，再按动作次序 `B < X < Y < W` 取字典序最小程序。答案唯一。

> 贪心为什么不够：逐时隙贪心（只看下一步偏差）可能走进“当时偏差小、后续被走廊/冷却逼到绕远”的分支，
> 得到非最短程序；分别压缩两轴节拍则会互相违反走廊。本工具对全部冷却状态 `(x,y,cx,cy)` 做完整穷举搜索。

## 2. 搜索算法（`src/core/scheduler.ts`）

1. **位置级可达性预检**：忽略冷却时先在 401×401 网格上 BFS。等待不改变坐标与偏差，
   若忽略冷却都无法穿过走廊到达目标，则可确定**无解**，并报告最远可达位置与 gcd 提示。
2. **后向 BFS 精确距离表**：从“目标位置上的所有冷却状态”出发，在状态空间 `(x,y,cx,cy)` 上
   逆向枚举全部直接前驱（B/X/Y/W 的精确逆转移），得到每个状态到目标的最短时隙距离。
   状态稠密编码进 `Int32Array`，最坏约 1300 万状态。
3. **字典序提取**：从起点沿“距离恰好减 1”的最短路径 DAG，按 `B,X,Y,W` 次序深度优先，
   第一个到达目标的程序即最短且字典序最小。
4. 交付前由**独立复算器**（`src/core/replay.ts`）逐时隙核验冷却、走廊与终态。

实测最坏输入（400×400、gap 8/8、全走廊）约 1297 万状态、约 0.5 s；搜索在 Web Worker 中运行，不冻结界面。

## 3. 界面功能

- **参数区**：X/Y 总步数（1–400）、X/Y 冷却间隔（0–8）、偏差上限（非负整数）。
  非法输入**一次性**在所有问题字段下标出原因，并清除旧结果。
- **综合结果**：程序字符串（BXYW 彩色）、总/脉冲/等待时隙统计、搜索状态数与耗时。
- **时间游标**：滑块/步进按钮逐时隙复核——SVG 坐标轨迹（理想直线 + 几何走廊 + 实际路径）、
  SVG 偏差曲线（±上限走廊线）、脉冲表（动作、脉冲、累计坐标、偏差、走廊判定、两轴冷却余量）。
- **无解**：明确显示判定原因（走廊不可达/上限与 gcd 关系/最远可达位置）。
- **导入/导出 JSON**：导出的 JSON 与界面表格、轨迹对应同一程序；导入时做 schema 校验并**重新逐时隙复算**，
  任何问题一次性列全，复算不通过则拒绝导入并清除旧结果。

导出 JSON 示例：

```json
{
  "app": "dual-axis-pulse-planner",
  "version": 1,
  "exportedAt": "2026-09-20T00:00:00.000Z",
  "params": { "totalX": 12, "totalY": 7, "gapX": 1, "gapY": 2, "tolerance": 6 },
  "program": "BWXWBXWBXWXYWXBWXWBWXBWW",
  "stats": { "totalSlots": 25, "pulseSlots": 13, "waitSlots": 12 }
}
```

## 4. 本地开发

```bash
npm install
npm run dev        # 开发服务器
npm run build      # tsc 类型检查 + vite 生产构建（输出 dist/）
npm run preview    # 本地预览生产产物
npm run test:unit  # 单元测试（含 2000 个实例与暴力 BFS 的穷举对拍）
npm run test:e2e   # Playwright 浏览器验收（自动起 preview）
```

## 5. Docker Compose（推荐交付方式）

```bash
# 构建并以后台方式运行（默认宿主机端口 8080）
docker compose up -d --build

# 使用自定义宿主机端口
HOST_PORT=9090 docker compose up -d --build
# 或复制 .env.example 为 .env 后修改 HOST_PORT

# 查看健康状态（web 服务带 /health 健康检查）
docker compose ps
curl -s http://localhost:8080/health   # -> ok

# 浏览器验收：verify 服务等待 web 健康后，用容器内 Chromium 执行 Playwright
docker compose build verify
docker compose run --rm verify
```

- `web`：多阶段构建出的静态文件由 nginx 提供（无业务后端），容器内固定 80 端口，
  宿主机端口由 `HOST_PORT` 配置；含容器级 HEALTHCHECK 与 compose `healthcheck`。
- `verify`：独立阶段镜像（node + 系统库 + Playwright Chromium），通过
  `BASE_URL=http://web:80` 对 compose 网络内的 `web` 执行 `tests/e2e` 全部浏览器验收用例。

## 6. 目录结构

```
src/
  core/
    types.ts        # 动作定义、增量、前缀状态
    validation.ts   # 参数与一次性全字段校验
    replay.ts       # 独立逐时隙复算器（冷却/走廊/终态，精确报错时隙）
    scheduler.ts    # 预检 + 后向 BFS + 字典序提取
    io.ts           # 导入/导出 JSON（schema 校验 + 复算）
    solve.worker.ts # Web Worker 包装
  components/       # 轨迹图、偏差曲线、脉冲表
  App.tsx           # 参数、综合、游标复核、导入导出
tests/
  unit/             # vitest：校验/复算/穷举对拍/性能/导入
  e2e/              # Playwright：7 个浏览器验收场景
Dockerfile          # runtime(nginx) 与 verify 两个目标阶段
docker-compose.yml  # web（可配置端口+健康检查）与 verify 服务
```
