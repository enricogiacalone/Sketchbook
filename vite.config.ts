import { defineConfig } from 'vite';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  publicDir: 'public',
  server: {
    open: true,
  },
  build: {
    outDir: 'build',
    sourcemap: true,
  },
  resolve: {
    alias: {
      '~': path.resolve(__dirname, './src/ts'),
      '$lib': path.resolve(__dirname, './src/lib'),
    },
  },
});
