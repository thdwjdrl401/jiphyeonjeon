import { selectDataSource } from '@/shared/api/dataSource'
import { httpLessonService } from './httpLessonService'
import type { GetLessonRequest, LessonService, SaveLessonRequest } from './lessonService.interface'
import { mockLessonService } from './mockLessonService'

const lessonService = selectDataSource<LessonService>(mockLessonService, httpLessonService)

export const getLesson = (request: GetLessonRequest) => lessonService.getLesson(request)
export const getCurriculumLessonNavigation = (curriculumId: string) => lessonService.getCurriculumLessonNavigation(curriculumId)
export const saveLesson = (request: SaveLessonRequest) => lessonService.saveLesson(request)
export const prepareLessonAi = (lessonId: string) => lessonService.prepareLessonAi(lessonId)
export const publishLesson = (lessonId: string) => lessonService.publishLesson(lessonId)
export const unpublishLesson = (lessonId: string) => lessonService.unpublishLesson(lessonId)

export type {
  GetLessonRequest,
  LessonDetailView,
  LessonMaterialView,
  LessonNavigationView,
  LessonService,
  SaveLessonRequest,
} from './lessonService.interface'
