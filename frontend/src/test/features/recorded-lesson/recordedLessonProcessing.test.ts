import { describe, expect, it } from 'vitest'
import {
  RECORDED_PROCESSING_POLL_INTERVAL_MS,
  recordedProcessingFailureMessage,
  recordedProcessingPollInterval,
  recordedProcessingStageIndex,
} from '@/features/recorded-lesson/recordedLessonProcessing'

describe('녹화강의 처리 화면 정책', () => {
  it.each(['QUEUED', 'TRANSCODING', 'VERIFYING'] as const)(
    '%s 상태는 3초 polling한다',
    (status) => {
      expect(recordedProcessingPollInterval(status)).toBe(RECORDED_PROCESSING_POLL_INTERVAL_MS)
    },
  )

  it.each(['READY', 'FAILED', 'AWAITING_UPLOAD'] as const)(
    '%s 상태는 polling하지 않는다',
    (status) => {
      expect(recordedProcessingPollInterval(status)).toBe(false)
    },
  )

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
