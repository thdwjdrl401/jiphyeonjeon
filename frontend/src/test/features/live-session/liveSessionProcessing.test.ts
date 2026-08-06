import { describe, expect, it } from 'vitest'
import {
  buildProcessingSteps,
  describeReplayBadge,
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

/**
 * 강의 상세의 다시보기 배지.
 *
 * <p>예전에는 이 자리에 <b>"VIDEO READY"가 문자열로 박혀</b> 있었다. 인코딩이 돌고 있든 실패했든
 * 강사에게는 늘 "검수 가능"으로 보였고, 눌러 들어가면 재생이 안 됐다. [ADR-0092]가 라이브 종료
 * 동선을 이 화면으로 바꾸면서 "상세가 이미 준비 상태를 보여 준다"를 전제했으므로, 그 전제를
 * 여기서 지킨다.
 */
describe('강의 상세 다시보기 배지', () => {
  it('처리 중이면 원이 돌고 처리 화면으로 보낸다', () => {
    for (const status of ['STARTING', 'RECORDING', 'FINALIZING', 'VERIFYING'] as const) {
      const badge = describeReplayBadge(snapshot(status), false)!
      expect(badge.busy, status).toBe(true)
      expect(badge.goTo, status).toBe('processing')
    }
  })

  /** 실패는 <b>끝난</b> 상태다. 원이 계속 돌면 아직 되는 중으로 읽혀 강사가 기다린다. */
  it('실패하면 원을 멈추고 붉게, 그래도 처리 화면으로 보낸다', () => {
    const badge = describeReplayBadge(snapshot('FAILED'), false)!
    expect(badge.busy).toBe(false)
    expect(badge.tone).toBe('danger')
    expect(badge.goTo).toBe('processing')
  })

  it('공개됐으면 성공 톤으로 다시보기를 가리킨다', () => {
    const badge = describeReplayBadge(snapshot('READY', 'PUBLISHED'), false)!
    expect(badge).toMatchObject({ tone: 'success', busy: false, goTo: 'replay' })
  })

  /** 영상은 준비됐지만 아직 공개 전 — 할 일이 남았으므로 성공으로 칠하지 않는다. */
  it('READY지만 미게시면 검수 대기로 구분한다', () => {
    const badge = describeReplayBadge(snapshot('READY', 'DRAFT'), false)!
    expect(badge).toMatchObject({ tone: 'warning', busy: false, goTo: 'replay' })
    expect(badge.label).not.toBe(describeReplayBadge(snapshot('READY', 'PUBLISHED'), false)!.label)
  })

  /** 없는 것을 "준비 중"이라고 말하지 않는다. */
  it('녹화를 켜지 않은 강의에는 배지를 그리지 않는다', () => {
    expect(describeReplayBadge({
      ...snapshot('FINALIZING'),
      recordingEnabled: false,
      videoAsset: null,
    }, false)).toBeNull()
  })

  it('아직 못 읽었으면 단정하지 않고 확인 중으로 둔다', () => {
    const badge = describeReplayBadge(undefined, true)!
    expect(badge.busy).toBe(true)
    expect(badge.goTo).toBeNull()   // 어디로 보낼지 모르는 상태에서 링크를 걸지 않는다
  })
})
