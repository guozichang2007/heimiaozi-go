import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:5177', ws: true },
      '/api': { target: 'http://localhost:5177' },
    },
  },
  build: {
    outDir: 'dist',
  },
});
