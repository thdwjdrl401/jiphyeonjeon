/** 자료가 어디에 매달려 있는지. 커리큘럼 공통 자료와 레슨 자료는 경로만 다르고 계약은 같다. */
export type MaterialDownloadScope = 'CURRICULUM' | 'LESSON'

export interface MaterialDownloadRequest {
  scope: MaterialDownloadScope
  /** `CURRICULUM`이면 curriculumId, `LESSON`이면 lessonId. */
  parentId: string
  materialId: string
  /** 저장될 파일 이름. presigned URL은 원본 이름을 모르므로(객체 키가 곧 이름) 화면이 들고 있어야 한다. */
  fileName: string
  /**
   * 강사 관리용 경로(`/instructor/**`)로 받을지 여부.
   *
   * 수강생 경로는 STUDENT 역할 + ACTIVE 수강(`ENROLLED`)을 요구해서 강사 계정은 통과하지 못한다
   * (docs/CONTRACT.md §수강생 자료 다운로드 접근 계약). 소유 강사는 자기 경로를 써야 한다.
   */
  asInstructor?: boolean
}

export interface MaterialDownloadService {
  /**
   * 자료 바이트를 받아 온다.
   *
   * 비로그인 401, 미수강·승인 대기 403, 그 부모에 연결되지 않은 자료 404를 `ApiError`로 던진다.
   */
  fetchMaterial: (request: MaterialDownloadRequest) => Promise<Blob>
}
