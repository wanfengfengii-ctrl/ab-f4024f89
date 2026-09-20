import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯前端应用；Docker 中由 nginx 提供静态产物，dev 仅本地使用
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
