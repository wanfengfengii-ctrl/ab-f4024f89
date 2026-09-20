# syntax=docker/dockerfile:1

# ---- 构建阶段：TypeScript 编译 + Vite 打包（纯前端静态产物） ----
FROM node:22-alpine AS build
WORKDIR /app

# 先装依赖，利用层缓存
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 复制源码并构建
COPY . .
RUN npm run build

# ---- 运行阶段：nginx 托管静态文件，无任何业务后端 ----
FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache wget

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

# 容器级健康检查（docker-compose.yml 中亦声明等效检查）
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
    CMD wget -q -O - http://127.0.0.1/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
