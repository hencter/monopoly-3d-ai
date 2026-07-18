import { defineConfig } from 'vite';

// /ds 代理到 DeepSeek API，规避浏览器 CORS（仅开发服务器需要；生产部署可自行反代）
export default defineConfig({
  server: {
    proxy: {
      '/ds': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/ds/, ''),
      },
    },
  },
});
