import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: path.resolve(__dirname, 'frontend'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@frontend': path.resolve(__dirname, 'src/frontend'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-frontend'),
    emptyOutDir: true,
  },
  server: {
    port: 3010,
    hmr: process.env.DISABLE_HMR !== 'true',
  },
});
