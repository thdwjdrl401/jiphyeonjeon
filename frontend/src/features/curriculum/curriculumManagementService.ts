import { selectDataSource } from '@/shared/api/dataSource'
import { httpCurriculumManagementService } from './httpCurriculumManagementService'
import { mockCurriculumManagementService } from './mockCurriculumManagementService'
import type {
  CreateCurriculumRequest,
  CurriculumManagementService,
  SaveCurriculumManagementRequest,
  UpdateCurriculumThumbnailRequest,
  UploadRecordedLessonRequest,
} from './curriculumManagementService.interface'

const curriculumManagementService = selectDataSource<CurriculumManagementService>(
  mockCurriculumManagementService,
  httpCurriculumManagementService,
)

export const uploadCurriculumThumbnail = (file: File) => curriculumManagementService.uploadCurriculumThumbnail(file)
export const updateCurriculumThumbnail = (request: UpdateCurriculumThumbnailRequest) =>
  curriculumManagementService.updateCurriculumThumbnail(request)
export const createCurriculum = (request: CreateCurriculumRequest) => curriculumManagementService.createCurriculum(request)
export const getInstructorCurriculum = (curriculumId: string) => curriculumManagementService.getInstructorCurriculum(curriculumId)
export const getCurriculumManagementStructure = (curriculumId: string) => curriculumManagementService.getCurriculumManagementStructure(curriculumId)
export const saveCurriculumManagement = (request: SaveCurriculumManagementRequest) => curriculumManagementService.saveCurriculumManagement(request)
export const publishCurriculum = (curriculumId: string) => curriculumManagementService.publishCurriculum(curriculumId)
export const deleteCurriculum = (curriculumId: string) => curriculumManagementService.deleteCurriculum(curriculumId)
export const deleteLesson = (lessonId: string) => curriculumManagementService.deleteLesson(lessonId)
export const deleteSection = (sectionId: string) => curriculumManagementService.deleteSection(sectionId)
export const uploadRecordedLesson = (request: UploadRecordedLessonRequest) => curriculumManagementService.uploadRecordedLesson(request)

export type {
  CreateCurriculumRequest,
  CurriculumManagementLesson,
  CurriculumManagementSection,
  CurriculumManagementService,
  InstructorCurriculumResponse,
  SaveCurriculumManagementRequest,
  SaveCurriculumManagementResult,
  UpdateCurriculumThumbnailRequest,
  UploadRecordedLessonRequest,
  UploadRecordedLessonResult,
} from './curriculumManagementService.interface'
