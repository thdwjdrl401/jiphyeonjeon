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

export interface SaveCurriculumManagementRequest {
  curriculumId: string
  info: { title: string; summary: string; description: string }
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
