import type { CurriculumMaterial } from './types'

export interface CreateCurriculumRequest {
  title: string
  summary: string
  description: string
  thumbnailAssetId: string | null
  thumbnailPreviewUrl: string | null
  materials?: CurriculumMaterial[]
  /** 커리큘럼 운영 시작 시각(ISO-8601). 미정이면 null. */
  startsAt: string | null
  /** 커리큘럼 운영 종료 시각(ISO-8601). 미정이면 null. */
  endsAt: string | null
}

export interface CreateCurriculumResponse {
  curriculumId: string
  /**
   * 운영 기간까지 저장됐는지. 생성 API가 기간을 받지 않아 PATCH로 이어 붙이므로
   * 초안만 남고 기간이 빠지는 경우가 있다 — 화면이 그 사실을 알려야 한다.
   */
  periodSaved: boolean
}

export interface InstructorCurriculumResponse {
  curriculumId: string
  title: string
  summary: string
  description: string
  thumbnailUrl: string | null
  lifecycleStatus: string
  /**
   * 운영 기간. 서버 `CurriculumResponse`가 처음부터 주던 값인데 이 타입이 빠뜨려서 관리 화면이
   * 쓰지 못했다 — 그래서 생성 때 기간을 놓치면 다시 넣을 방법이 없었고, 카탈로그 카드가 영구히
   * "일정 준비 중"에 머물렀다. 한쪽만 정해진 상태도 서버가 허용하므로 각각 nullable이다.
   */
  startsAt: string | null
  endsAt: string | null
  sectionCount: number
  lessonCount: number
  publishedLessonCount: number
  structureVersion: number
  materials: CurriculumMaterial[]
  enrolleeCount: number | null
}

export interface CurriculumManagementLesson {
  lessonId: string
  title: string
  status: string
  /** 구버전 mock 데이터는 없을 수 있어 optional이며, HTTP 응답은 항상 LIVE|RECORDED를 준다. */
  deliveryType?: 'LIVE' | 'RECORDED'
}

export interface CurriculumManagementSection {
  sectionId: string
  title: string
  description: string
  order: number
  lessons: CurriculumManagementLesson[]
}

/**
 * 대표 이미지 교체(ADR-0076). 자동 저장 지문에 태우지 않고 <b>고른 즉시</b> 보낸다 — 파일 선택은
 * 타이핑처럼 이어지는 입력이 아니라 한 번의 이산적 사건이고, 저장 전후 지문(파일 이름 → 서버 URL)이
 * 달라 디바운스 경로에 태우면 저장이 한 번 더 도는 것을 막을 방법이 마땅치 않다.
 */
export interface UpdateCurriculumThumbnailRequest {
  curriculumId: string
  /** 업로드 완료(UPLOADED)한 본인 THUMBNAIL 에셋. 서버가 소유·종류·상태를 검증한다(409). */
  thumbnailAssetId: string
  /** 목 구현이 화면에 되돌려 줄 미리보기 URL. HTTP 구현은 서버가 준 URL을 쓰므로 무시한다. */
  thumbnailPreviewUrl: string | null
}

export interface SaveCurriculumManagementRequest {
  curriculumId: string
  /**
   * PATCH /instructor/curriculums/{id} 본문. 기간은 ISO-8601이며 "미정"은 null이다 —
   * 서버는 null을 "변경 안 함"으로 다루므로, 이 화면은 값이 비어 있어도 기존 기간을 지우지 않는다.
   */
  info: { title: string; summary: string; description: string; startsAt: string | null; endsAt: string | null }
  sections: CurriculumManagementSection[]
  materials: CurriculumMaterial[]
  structureVersion: number
}

export interface SaveCurriculumManagementResult {
  /** 저장 후 서버의 structureVersion. 다음 저장의 baseVersion으로 쓴다(연속 저장 시 409 방지). */
  structureVersion: number
  /** 새로 만든 섹션의 임시 id(sec-new-*) → 실제 sectionId. 로컬 상태를 실제 id로 바꿔 중복 생성을 막는다. */
  sectionIdMap: Record<string, string>
  /**
   * 저장 후 서버에 반영된 커리큘럼 자료(ADR-0042). 새로 올린 자료는 실제 materialId를 갖고 File은 없다 —
   * 화면이 로컬 상태를 이 목록으로 교체해 같은 파일을 다음 저장에서 다시 올리지 않게 한다.
   */
  materials: CurriculumMaterial[]
}

export interface UploadRecordedLessonRequest {
  /** 같은 화면에서 업로드를 재시도해도 레슨이 중복 생성되지 않게 유지하는 멱등키. */
  clientRequestId: string
  curriculumId: string
  sectionId: string
  title: string
  description: string
  videoFile: File
  /** 녹화강의 생성 뒤 같은 레슨 자료 API로 연결할 PPTX 원본. */
  materials: File[]
}

export interface UploadRecordedLessonResult {
  lessonId: string
  recordedVideoId: string
  jobId: string
  /** 원본 업로드 뒤 재생본을 준비하는 비동기 상태. */
  processingStatus: 'QUEUED'
}

export interface CurriculumManagementService {
  uploadCurriculumThumbnail: (file: File) => Promise<string | null>
  /** 대표 이미지를 교체한다. 저장 후의 커리큘럼(서버 진실)을 돌려준다. */
  updateCurriculumThumbnail: (request: UpdateCurriculumThumbnailRequest) => Promise<InstructorCurriculumResponse>
  /**
   * 대표 이미지 연결을 해제한다. 이미 없어도 성공한다(멱등). 저장 후의 커리큘럼을 돌려준다.
   *
   * <p>교체와 <b>다른 endpoint</b>다 — 기본 정보 PATCH는 `thumbnailAssetId: null`을 "변경 안 함"으로
   * 읽으므로 그 길로는 비울 수 없다. 서버는 연결만 끊고 업로드된 에셋·스토리지 객체는 즉시 지우지
   * 않는다(CONTRACT §커리큘럼, seominkyeong/ADR-0077).
   */
  deleteCurriculumThumbnail: (curriculumId: string) => Promise<InstructorCurriculumResponse>
  createCurriculum: (request: CreateCurriculumRequest) => Promise<CreateCurriculumResponse>
  getInstructorCurriculum: (curriculumId: string) => Promise<InstructorCurriculumResponse>
  getCurriculumManagementStructure: (curriculumId: string) => Promise<CurriculumManagementSection[]>
  saveCurriculumManagement: (request: SaveCurriculumManagementRequest) => Promise<SaveCurriculumManagementResult>
  publishCurriculum: (curriculumId: string) => Promise<void>
  /** 초안(DRAFT)만 삭제할 수 있다. 공개·보관 상태면 서버가 409 CURRICULUM_STATE_CONFLICT로 거절한다. */
  deleteCurriculum: (curriculumId: string) => Promise<void>
  deleteLesson: (lessonId: string) => Promise<void>
  deleteSection: (sectionId: string) => Promise<void>
  uploadRecordedLesson: (request: UploadRecordedLessonRequest) => Promise<UploadRecordedLessonResult>
}
