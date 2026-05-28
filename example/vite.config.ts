import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      morphkit: path.resolve(__dirname, '../src/index.ts'),
    },
  },
  server: {
    fs: {
      // Allow serving files from the parent morphkit/src directory
      allow: ['..'],
    },
  },
  worker: {
    format: 'es',
  },
});
