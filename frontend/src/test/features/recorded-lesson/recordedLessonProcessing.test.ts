import { describe, expect, it } from 'vitest'
import {
  RECORDED_PROCESSING_POLL_INTERVAL_MS,
  recordedProcessingFailureMessage,
  recordedProcessingPollInterval,
  recordedProcessingStageIndex,
} from '@/features/recorded-lesson/recordedLessonProcessing'
import type {
  RecordedCaptionStatus,
  RecordedProcessingStatus,
  RecordedProcessingView,
} from '@/features/recorded-lesson/recordedLessonService.interface'

function processing(
  status: RecordedProcessingStatus,
  captionStatus: RecordedCaptionStatus = 'PROCESSING',
  recordedPublicationStatus: 'DRAFT' | 'PUBLISHED' = 'DRAFT',
): RecordedProcessingView {
  return {
    lessonId: 'lesson-1',
    recordedVideoId: 'video-1',
    jobId: 'job-1',
    status,
    failureCode: null,
    durationMs: status === 'READY' ? 60_000 : null,
    sizeBytes: status === 'READY' ? 1_024 : null,
    readyAt: status === 'READY' ? '2026-08-04T00:00:00Z' : null,
    captionStatus,
    captionFailureCode: null,
    captionProcessedChunks: 1,
    captionTotalChunks: 2,
    captionReadyAt: null,
    recordedPublicationStatus,
    publishedAt: recordedPublicationStatus === 'PUBLISHED' ? '2026-08-04T00:01:00Z' : null,
  }
}

describe('녹화강의 처리 화면 정책', () => {
  it.each(['QUEUED', 'TRANSCODING', 'VERIFYING'] as const)(
    '%s 상태는 3초 polling한다',
    (status) => {
      expect(recordedProcessingPollInterval(processing(status))).toBe(RECORDED_PROCESSING_POLL_INTERVAL_MS)
    },
  )

  it('HLS가 READY여도 자막 처리 중이면 polling을 계속한다', () => {
    expect(recordedProcessingPollInterval(processing('READY', 'PROCESSING')))
      .toBe(RECORDED_PROCESSING_POLL_INTERVAL_MS)
  })

  it('게시 완료 또는 실패가 관찰되면 polling하지 않는다', () => {
    expect(recordedProcessingPollInterval(processing('READY', 'READY', 'PUBLISHED'))).toBe(false)
    expect(recordedProcessingPollInterval(processing('FAILED', 'READY'))).toBe(false)
    expect(recordedProcessingPollInterval(processing('READY', 'FAILED'))).toBe(false)
    expect(recordedProcessingPollInterval(processing('FAILED', 'PROCESSING'))).toBe(false)
    expect(recordedProcessingPollInterval(processing('TRANSCODING', 'FAILED'))).toBe(false)
  })

  it('처리 단계 순서를 고정한다', () => {
    expect(recordedProcessingStageIndex('QUEUED')).toBe(0)
    expect(recordedProcessingStageIndex('TRANSCODING')).toBe(1)
    expect(recordedProcessingStageIndex('VERIFYING')).toBe(2)
    expect(recordedProcessingStageIndex('READY')).toBe(3)
  })

  it('안정된 실패 코드를 사용자 메시지로 매핑한다', () => {
    expect(recordedProcessingFailureMessage('FFMPEG_FAILED')).toBe('영상을 HLS로 변환하지 못했습니다.')
    expect(recordedProcessingFailureMessage('UNKNOWN')).toBe('영상 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.')
  })
})
