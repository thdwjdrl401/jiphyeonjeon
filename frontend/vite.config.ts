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
          if (
            normalizedId.includes('/node_modules/@vidstack/')
            || normalizedId.includes('/node_modules/hls.js/')
            || normalizedId.includes('/node_modules/media-captions/')
            || normalizedId.includes('/node_modules/@floating-ui/')
          ) {
            return 'vidstack-vendor'
          }
          /*
           * react 계열은 이름으로 정확히 짚는다. `id.includes('react')`처럼 느슨하게 잡으면 경로에
           * "react"가 든 무관한 패키지까지 끌려온다 — Excalidraw의 `@radix-ui/react-*`,
           * `react-remove-scroll` 등이 그렇다. 그것들이 eager 청크에 들어가면 판서를 쓰지 않는
           * 수강생도 내려받게 된다.
           */
          if (/\/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(normalizedId)) {
            return 'react-vendor'
          }
          if (normalizedId.includes('/node_modules/@tanstack/')) {
            return 'react-vendor'
          }
          /*
           * 나머지는 Rollup의 자동 분할에 맡긴다(undefined).
           *
           * 전에는 여기서 `'vendor'`를 돌려 node_modules 전부를 한 청크로 묶었다. 그러면
           * <b>동적 import가 무력화된다</b> — manualChunks가 코드 분할보다 우선하므로, 지연 로드하려던
           * 의존성이 entry가 preload하는 vendor 청크에 흡수된다. Excalidraw(+2.4MB gzip)를 강사
           * 화면에서만 쓰려고 동적 import했는데 수강생까지 내려받는 일이 실제로 벌어졌다(ADR-0051).
           *
           * undefined면 Rollup이 정적/동적 도달 관계를 보고 나눈다. 여러 청크가 공유하는 모듈은
           * 공유 청크로 빠지고, 지연 경로에서만 쓰는 모듈은 지연 청크에 남는다.
           */
          return undefined
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
