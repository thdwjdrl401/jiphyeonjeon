import type { RecordedUploadProgress } from '@/features/curriculum/curriculumManagementService.interface'
import type { MaterialUploadProgress } from '@/features/lesson/lessonService.interface'

/**
 * 녹화강의 업로드 단계를 사용자의 말로 옮긴다.
 *
 * 단계 이름을 그대로 보여 주지 않는다 — `REQUESTING_PROCESSING`은 강사에게 아무 뜻도 아니다.
 * 파일이 여러 개일 때만 "(1/3)"을 붙인다. 한 개뿐인데 (1/1)을 달면 세는 척만 하는 소음이다.
 */
export function recordedUploadLabel(progress: RecordedUploadProgress): string {
  switch (progress.stage) {
    case 'CREATING_LESSON':
      return '강의를 만드는 중…'
    case 'UPLOADING_MATERIALS': {
      const position = (progress.materialCount ?? 0) > 1
        ? ` (${progress.materialIndex}/${progress.materialCount})`
        : ''
      return `강의 자료 업로드 중${position} · ${progress.fileName ?? ''}`
    }
    case 'UPLOADING_VIDEO':
      return '영상 업로드 중…'
    default:
      // 바이트는 다 갔고 서버가 변환 잡을 받는 중이다. 여기서 창을 닫아도 업로드는 이미 끝났다.
      return '영상 처리를 요청하는 중…'
  }
}

/** 강의 저장 중 자료 업로드. 여기서 시간을 쓰는 건 자료 바이트뿐이다. */
export function materialUploadLabel(progress: MaterialUploadProgress): string {
  const position = progress.count > 1 ? ` (${progress.index}/${progress.count})` : ''
  return `강의 자료 업로드 중${position} · ${progress.fileName}`
}
