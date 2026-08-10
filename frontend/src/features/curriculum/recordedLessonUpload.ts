import type { RecordedVideoCapabilities } from './curriculumManagementService.interface'

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
  if (file.size > RECORDED_LESSON_MAX_BYTES) return '영상 파일은 최대 5GiB까지 업로드할 수 있습니다.'
  return null
}

/**
 * 업로드가 잠겨 있으면 그 이유를 돌려준다. 열려 있거나 <b>아직 모르면</b> null이다.
 *
 * <p>모를 때 열어 두는 것은 의도다 — 이 값은 안내이고 게이트가 아니다. 서버가 계속 503으로
 * 막으므로, 조회 실패를 잠금으로 바꾸면 멀쩡한 환경에서 업로드를 못 하게 만들 뿐이다.
 *
 * <p>자막이 닫힌 쪽이 실제 운영 상태다(`RECORDED_STT_ENABLED=false`). 자막이 READY|EMPTY가
 * 되어야 재생 패키지가 게시되므로, 자막만 닫혀도 업로드는 의미가 없다 — 서버도 티켓 발급
 * 단계에서 막는다.
 */
export function recordedUploadLockReason(capabilities?: RecordedVideoCapabilities): string | null {
  if (!capabilities) return null
  if (!capabilities.videoUploadEnabled) {
    return '녹화강의 업로드 기능이 닫혀 있습니다. 실시간 강의는 그대로 사용할 수 있습니다.'
  }
  if (!capabilities.captionGenerationEnabled) {
    return '업로드한 영상의 자막은 실시간 강의와 달리 외부 STT API를 호출해 만듭니다. '
      + '이 API는 쓴 만큼 요금이 붙어 지금은 잠가 두었습니다. '
      + '실시간 강의와 자막은 그대로 사용할 수 있습니다.'
  }
  return null
}

/**
 * 상한이 5GiB인데 MB에서 멈춰 있었다 — 업로드 요약의 `원본 크기`가 <b>5120.0 MB</b>로 떴다.
 * 사람이 파일 크기를 그렇게 읽지 않는다.
 */
export function formatRecordedLessonFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
