import { selectDataSource } from '@/shared/api/dataSource'
import { httpMyCurriculumsService } from './httpMyCurriculumsService'
import { mockMyCurriculumsService } from './mockMyCurriculumsService'
import type { InstructorCurriculumQuery, MyCurriculumsService } from './myCurriculumsService.interface'

const myCurriculumsService = selectDataSource<MyCurriculumsService>(
  mockMyCurriculumsService,
  httpMyCurriculumsService,
)

export const getInstructorCurriculums = (query: InstructorCurriculumQuery, userId: string) =>
  myCurriculumsService.getInstructorCurriculums(query, userId)
export const getStudentDashboardSummary = (userId: string) => myCurriculumsService.getStudentDashboardSummary(userId)
export const getInstructorDashboardSummary = (userId: string) => myCurriculumsService.getInstructorDashboardSummary(userId)

export type {
  DashboardLiveSession,
  InstructorCurriculumItem,
  InstructorCurriculumQuery,
  InstructorCurriculumSort,
  InstructorDashboardSummary,
  MyCurriculumsService,
  NextLiveSessionSummary,
  PageResponse,
  StudentDashboardSummary,
  StudentLearningSummary,
} from './myCurriculumsService.interface'
