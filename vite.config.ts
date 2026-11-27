import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
      dedupe: ['@zcatalyst/auth'],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      proxy: {
        '/__catalyst': {
          target: 'https://project-rainfall-943998020.development.catalystserverless.com',
          changeOrigin: true,
          secure: true,
          xfwd: true,
          cookieDomainRewrite: '',
          cookiePathRewrite: '/',
        },
        '/api/v1': {
          target: 'https://project-rainfall-943998020.development.catalystserverless.com/server/vigor_api',
          changeOrigin: true,
          secure: true,
          xfwd: true,
          cookieDomainRewrite: '',
          cookiePathRewrite: '/',
          configure: (proxy) => {
            proxy.on('proxyRes', (proxyRes) => {
              const setCookie = proxyRes.headers['set-cookie'];
              if (Array.isArray(setCookie)) {
                proxyRes.headers['set-cookie'] = setCookie.map((cookie) =>
                  cookie.replace(/;\s*Domain=[^;]+/gi, '').replace(/;\s*Path=[^;]+/gi, '; Path=/')
                );
              }
            });
          },
        },
      },
    },
  };
});
