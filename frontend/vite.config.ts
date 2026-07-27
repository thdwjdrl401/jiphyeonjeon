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
    proxy: {
      '/api': {
        target: 'http://localhost:8080/',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) {
            return undefined
          }
          const normalizedId = id.replace(/\\/g, '/')
          if (
            normalizedId.includes('/node_modules/livekit-client/')
            || normalizedId.includes('/node_modules/@livekit/')
            || normalizedId.includes('/node_modules/@bufbuild/protobuf/')
            || normalizedId.includes('/node_modules/webrtc-adapter/')
            || normalizedId.includes('/node_modules/sdp-transform/')
            || normalizedId.includes('/node_modules/sdp/')
            || normalizedId.includes('/node_modules/jose/')
            || normalizedId.includes('/node_modules/loglevel/')
            || normalizedId.includes('/node_modules/events/')
            || normalizedId.includes('/node_modules/typed-emitter/')
          ) {
            return 'livekit-vendor'
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
    clearMocks: true,
  },
})
