# ---------- 构建阶段：编译 TypeScript + React 静态产物 ----------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- 运行阶段：纯静态文件由 nginx 提供，无任何业务后端 ----------
# alpine 自带 busybox wget，供容器健康检查使用
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget -q -O - http://127.0.0.1/health || exit 1

# ---------- 验收阶段：Playwright + Chromium，对运行中的 web 服务执行浏览器验收 ----------
FROM node:22-bookworm-slim AS verify
WORKDIR /app
# 先装系统库再装浏览器（官方镜像内以 root 运行，apt 可用）
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
     libnspr4 libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
     libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libxkbcommon0 \
     libasound2 libcups2 libxi6 libdrm2 libwayland-server0 \
     libavahi-client3 libavahi-common3 \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
  && npx playwright install chromium
COPY . .
RUN npm run build
ENV BASE_URL=http://web:80
# 覆盖方式：docker compose run --rm verify npx playwright test
CMD ["npx", "playwright", "test"]
