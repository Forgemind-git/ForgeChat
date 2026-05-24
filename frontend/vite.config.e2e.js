import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://172.19.0.10:3011',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://172.19.0.10:3011',
        changeOrigin: true,
      },
    },
  },
});
