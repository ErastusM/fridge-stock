/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  // `--mode demo` (.env.demo) builds the in-browser demo, served by GitHub Pages from /fridge-stock/.
  base: mode === 'demo' ? '/fridge-stock/' : '/',
  plugins: [react(), tailwindcss()],
  server: {
    // Loopback only in development. To test on a real tablet on the LAN, run `npm run dev -- --host`.
    host: '127.0.0.1',
    port: 5180,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:4100' },
  },
  preview: { host: '127.0.0.1', port: 5185, strictPort: true },
  test: { environment: 'node' },
}));
