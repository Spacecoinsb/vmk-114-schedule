import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  resolve: {alias: {'@': path.resolve(__dirname)}},
  build: {outDir: 'dist'},
});
