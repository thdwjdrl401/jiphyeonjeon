import { describe, expect, it } from 'vitest'
import {
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
