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
    // clearMocks는 호출 기록만 지운다 — vi.spyOn은 그대로 남아 다음 테스트까지 살아남고, 그래서 순서에
    // 따라 결과가 달라졌다(shuffle 시드 3개로 4건 재현). 다만 전역 restoreMocks는 쓰지 않는다: 이 코드베이스는
    // 모듈 레벨 `vi.mock` 팩토리 안에서 `vi.fn(구현)`으로 목을 만드는데, restoreAllMocks가 그 구현까지
    // 되돌려 Room 목이 undefined가 된다(실측 12개 실패). 스파이를 남기는 파일에서 afterEach로 개별 원복한다.
    // 개별 테스트 한도. setup.ts의 asyncUtilTimeout(5초)을 여러 번 기다리는 테스트가 있어
    // 기본 5초로는 부하가 걸린 러너에서 테스트 자체가 먼저 끊긴다.
    testTimeout: 30_000,
    // 시각 포맷 단언(`오후 7:00` 등)은 KST를 전제한다. 지금까지 그 보장은 .gitlab-ci.yml의 TZ 환경변수
    // 하나에만 있어 로컬(UTC 계열)에서는 깨졌다. 하네스에 박아 어디서 돌려도 같게 만든다.
    env: { TZ: 'Asia/Seoul' },
    poolOptions: {
      // CI에서만 조인다. 기본값(코어 수만큼 fork)은 러너를 통째로 먹어 같이 도는 잡과 — lazy에서는
      // 라이브 강의 녹화(Egress)와도 — CPU를 다툰다.
      //
      // 4로 정한 근거(8코어 전용 러너 실측, 120파일·1004건):
      //   forks 2 → 107초    forks 4 → 73초    forks 6 → 64초    forks 8 → 63초
      // 4를 넘으면 얻는 게 급격히 줄고(코어 포화), 대신 다른 잡과 녹화에 남길 여유가 사라진다.
      // 2에서 4로 올리는 것만으로 34초를 줄이면서 절반을 남겨 두는 지점이 4다.
      //
      // **minForks를 같이 줘야 한다.** 안 주면 기본 최소값이 코어 수에서 파생되어 maxForks를
      // 넘고, tinypool이 "minThreads and maxThreads must not conflict"로 던져 테스트가 한 건도
      // 돌지 않는다. 4코어에서는 우연히 맞아떨어져 드러나지 않았고 8코어 러너에서 터졌다 —
      // 러너 장비가 바뀌면 조용히 깨지는 자리라 두 값을 함께 고정한다.
      forks: process.env.CI ? { minForks: 1, maxForks: 4 } : {},
    },
  },
})
