import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        exposicao: resolve(__dirname, 'index.html'),
        loja: resolve(__dirname, 'loja.html'),
      },
    },
  },
});
