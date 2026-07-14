import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 8083,
    open: true,
    proxy: {
      '/api/v1': {
        target: 'http://localhost:8080/',
        changeOrigin: true,
      },
      '/webjars': {
        target: 'http://localhost:8080/',
        changeOrigin: true,
      },
      '/group-call': {
        target: 'http://localhost:8080/',
        changeOrigin: true,
      },
      '/upload': {
        target: 'http://localhost:8080/',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../backend/src/main/resources/dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }
          if (id.includes('react') || id.includes('react-router')) {
            return 'react-vendor'
          }
          return 'vendor'
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
})
