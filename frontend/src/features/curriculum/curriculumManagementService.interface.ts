import type { CurriculumMaterial } from './types'

export interface CreateCurriculumRequest {
  title: string
  summary: string
  description: string
  thumbnailAssetId: string | null
  thumbnailPreviewUrl: string | null
  materials?: CurriculumMaterial[]
}

export interface CreateCurriculumResponse {
  curriculumId: string
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
}
