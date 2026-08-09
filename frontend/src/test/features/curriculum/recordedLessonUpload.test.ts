import { describe, expect, it } from 'vitest'
import {
  formatRecordedLessonFileSize,
  RECORDED_LESSON_MAX_BYTES,
  validateRecordedLessonVideo,
} from '@/features/curriculum/recordedLessonUpload'

function videoFile(size: number): File {
  return {
    name: 'lecture.mp4',
    type: 'video/mp4',
    size,
  } as File
}

describe('녹화강의 원본 크기 계약', () => {
  it('5GiB는 허용하고 1 byte라도 초과하면 거절한다', () => {
    expect(RECORDED_LESSON_MAX_BYTES).toBe(5_368_709_120)
    expect(validateRecordedLessonVideo(videoFile(RECORDED_LESSON_MAX_BYTES))).toBeNull()
    expect(validateRecordedLessonVideo(videoFile(RECORDED_LESSON_MAX_BYTES + 1)))
      .toBe('영상 파일은 최대 5GiB까지 업로드할 수 있습니다.')
  })
})

/**
 * 상한이 5GiB인데 표시가 MB에서 멈춰 있었다 — 업로드 요약의 `원본 크기`가 <b>5120.0 MB</b>로 떴다.
 * 사람이 파일 크기를 그렇게 읽지 않는다.
 */
describe('파일 크기 표시', () => {
  it('1GiB 이상은 GB로 읽는다', () => {
    expect(formatRecordedLessonFileSize(5 * 1024 * 1024 * 1024)).toBe('5.00 GB')
    expect(formatRecordedLessonFileSize(1.5 * 1024 * 1024 * 1024)).toBe('1.50 GB')
  })

  it('그 아래는 예전 그대로다', () => {
    expect(formatRecordedLessonFileSize(700 * 1024 * 1024)).toBe('700.0 MB')
    expect(formatRecordedLessonFileSize(30 * 1024)).toBe('30 KB')
  })
})
