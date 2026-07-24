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

export interface CurriculumManagementService {
  uploadCurriculumThumbnail: (file: File) => Promise<string | null>
  createCurriculum: (request: CreateCurriculumRequest) => Promise<CreateCurriculumResponse>
  getInstructorCurriculum: (curriculumId: string) => Promise<InstructorCurriculumResponse>
  getCurriculumManagementStructure: (curriculumId: string) => Promise<CurriculumManagementSection[]>
  saveCurriculumManagement: (request: SaveCurriculumManagementRequest) => Promise<void>
  publishCurriculum: (curriculumId: string) => Promise<void>
  deleteLesson: (lessonId: string) => Promise<void>
  deleteSection: (sectionId: string) => Promise<void>
}
