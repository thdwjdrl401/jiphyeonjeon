import { describe, expect, it } from 'vitest'
import {
  buildProcessingSteps,
  isProcessingTerminal,
  isReplayReady,
  processingPollInterval,
} from '@/features/live-session/liveSessionProcessing'
import type {
  ProcessingStatus,
  ReplayStatus,
  VideoAssetStatus,
} from '@/features/live-session/liveSessionService.interface'

function snapshot(
  status: VideoAssetStatus,
  replayStatus: ReplayStatus = 'DRAFT',
): ProcessingStatus {
  return {
    sessionId: 'ses-1',
    liveSessionStatus: 'ENDED',
    recordingEnabled: true,
    startedAt: '2026-08-01T10:00:00+09:00',
    endedAt: '2026-08-01T11:32:00+09:00',
    videoAsset: {
      videoAssetId: 'asset-1',
      status,
      replayStatus,
      failureCode: status === 'FAILED' ? 'MANIFEST_MISSING' : null,
      durationMs: status === 'READY' ? 60_000 : null,
      sizeBytes: status === 'READY' ? 10_000 : null,
      recordingStartedAt: '2026-08-01T10:00:04+09:00',
      recordingEndedAt: '2026-08-01T11:32:00+09:00',
    },
  }
}

describe('녹화 처리 화면 정책', () => {
  it('첫 30초는 2초, 이후 진행 상태는 5초 간격으로 조회한다', () => {
    const finalizing = snapshot('FINALIZING')
    expect(processingPollInterval(finalizing, 0)).toBe(2_000)
    expect(processingPollInterval(finalizing, 29_999)).toBe(2_000)
    expect(processingPollInterval(finalizing, 30_000)).toBe(5_000)
  })

  it('READY와 FAILED 및 자산 없음은 terminal이라 폴링을 멈춘다', () => {
    expect(isProcessingTerminal(snapshot('READY', 'PUBLISHED'))).toBe(true)
    expect(isProcessingTerminal(snapshot('READY', 'DRAFT'))).toBe(true)
    expect(isProcessingTerminal(snapshot('FAILED'))).toBe(true)
    expect(isProcessingTerminal({
      ...snapshot('FINALIZING'),
      recordingEnabled: false,
      videoAsset: null,
    })).toBe(true)
    expect(processingPollInterval(snapshot('FAILED'), 1_000)).toBe(false)
  })

  it('READY와 PUBLISHED를 모두 확인한 경우에만 자동 이동 조건을 만족한다', () => {
    expect(isReplayReady(snapshot('READY', 'PUBLISHED'))).toBe(true)
    expect(isReplayReady(snapshot('READY', 'DRAFT'))).toBe(false)
    expect(isReplayReady(snapshot('FAILED', 'PUBLISHED'))).toBe(false)
  })

  it('서버 상태 축을 구분해 단계 표시를 만든다', () => {
    expect(buildProcessingSteps(snapshot('VERIFYING')).map((step) => step.status))
      .toEqual(['COMPLETE', 'COMPLETE', 'PROCESSING', 'PENDING'])
    expect(buildProcessingSteps(snapshot('READY', 'PUBLISHED')).map((step) => step.status))
      .toEqual(['COMPLETE', 'COMPLETE', 'COMPLETE', 'COMPLETE'])
    expect(buildProcessingSteps(snapshot('FAILED')).map((step) => step.status))
      .toEqual(['COMPLETE', 'FAILED', 'FAILED', 'FAILED'])
  })
})
