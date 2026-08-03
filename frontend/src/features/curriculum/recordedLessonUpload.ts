export const RECORDED_LESSON_VIDEO_ACCEPT = '.mp4,video/mp4'
export const RECORDED_LESSON_MAX_BYTES = 5 * 1024 * 1024 * 1024

/**
 * 브라우저가 주는 MIME은 비어 있을 수 있어 확장자와 함께 본다. 둘 중 하나라도 MP4가 아닌
 * 값으로 명시되면 막아, 영상 처리 서버가 없는 현재 화면에서도 잘못된 파일을 일찍 안내한다.
 */
export function validateRecordedLessonVideo(file: File): string | null {
  const hasMp4Extension = file.name.toLocaleLowerCase().endsWith('.mp4')
  const hasMp4Mime = file.type === '' || file.type.toLocaleLowerCase() === 'video/mp4'

  if (!hasMp4Extension || !hasMp4Mime) return 'MP4 형식의 영상 파일만 선택할 수 있습니다.'
  if (file.size <= 0) return '내용이 없는 영상 파일은 업로드할 수 없습니다.'
  if (file.size > RECORDED_LESSON_MAX_BYTES) return '영상 파일은 최대 5GB까지 업로드할 수 있습니다.'
  return null
}

export function formatRecordedLessonFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
