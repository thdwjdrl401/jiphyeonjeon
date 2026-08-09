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

/**
 * 녹화강의 업로드가 지나가는 단계. 순서가 곧 실행 순서다.
 *
 * 자료가 영상보다 먼저다 — 자료 연결이 실패하면 영상은 AWAITING_UPLOAD에 남아 같은 멱등키로
 * 이어서 재시도할 수 있다(반대 순서면 올린 영상이 붕 뜬다).
 */
export type RecordedUploadStage =
  | 'CREATING_LESSON'
  | 'UPLOADING_MATERIALS'
  | 'UPLOADING_VIDEO'
  | 'REQUESTING_PROCESSING'

export interface RecordedUploadProgress {
  stage: RecordedUploadStage
  /** 바이트 전송 비율(0~1). 전체 크기를 모르거나 바이트를 보내지 않는 단계면 null. */
  ratio: number | null
  /** 자료 단계에서 지금 몇 번째를 올리는지(1-based). 다른 단계에서는 없다. */
  materialIndex?: number
  materialCount?: number
  /** 지금 올리는 파일 이름. 어느 파일에서 멈췄는지 알아야 재시도를 판단할 수 있다. */
  fileName?: string
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
  /**
   * 자료 하나가 <b>연결까지 끝났을 때</b> 부른다. 실패 뒤 재시도에서 이미 붙은 자료를 건너뛰라고
   * 알리는 신호다(ADR-0109).
   *
   * <p>없으면 재시도가 자료 루프를 처음부터 다시 돈다 — 같은 PPTX가 두 번 붙고, 그때마다
   * 수강생 전원에게 자료 알림이 다시 나간다(ADR-0073).
   *
   * <p>아래 {@link #onProgress}와 다른 축이다. 이건 <b>어디까지 끝났나</b>(재시도 재개점)이고,
   * 저건 <b>지금 얼마나 갔나</b>(화면 표시)다.
   */
  onMaterialLinked?: (file: File) => void
  /**
   * 단계·전송량 보고. 5GiB MP4를 올리는 동안 화면이 "업로드 중…" 한 줄만 띄우고 있었다 —
   * 진행도 단계도 알 수 없어, 멈춘 건지 되는 중인지 구분할 방법이 없었다.
   */
  onProgress?: (progress: RecordedUploadProgress) => void
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
  /**
   * 보관: PUBLISHED → ARCHIVED. 카탈로그에서 내려가 신규 수강신청이 막힌다.
   * <b>되돌릴 수 없다</b> — 서버에 ARCHIVED에서 나가는 전이가 없다.
   * 이미 듣던 수강생은 계속 볼 수 있다(서버가 접근을 막지 않는다).
   */
  archiveCurriculum: (curriculumId: string) => Promise<void>
  /** 초안(DRAFT)만 삭제할 수 있다. 공개·보관 상태면 서버가 409 CURRICULUM_STATE_CONFLICT로 거절한다. */
  deleteCurriculum: (curriculumId: string) => Promise<void>
  deleteLesson: (lessonId: string) => Promise<void>
  deleteSection: (sectionId: string) => Promise<void>
  uploadRecordedLesson: (request: UploadRecordedLessonRequest) => Promise<UploadRecordedLessonResult>
}
