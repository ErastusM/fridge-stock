/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Relative paths: the same build works on GitHub Pages (/fridge-stock/) and at a site root.
  base: './',
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 5185, strictPort: true },
  test: { environment: 'node' },
});
