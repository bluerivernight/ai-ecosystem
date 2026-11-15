import { defineConfig } from 'vite'

export default defineConfig({
  root: 'client',
  base: './',
  build: {
    outDir: '../dist-client',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022'
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true }
    }
  }
})
