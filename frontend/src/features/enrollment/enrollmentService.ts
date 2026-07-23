import { selectDataSource } from '@/shared/api/dataSource'
import type { EnrollmentService } from './enrollmentService.interface'
import { httpEnrollmentService } from './httpEnrollmentService'
import { mockEnrollmentService } from './mockEnrollmentService'
import type { EnrollmentRosterQuery, InstructorEnrollmentAction } from './types'

export const enrollmentService = selectDataSource<EnrollmentService>(
  mockEnrollmentService,
  httpEnrollmentService,
)

export const enrollInCurriculum = (curriculumId: string) => enrollmentService.apply(curriculumId)
export const cancelEnrollment = (curriculumId: string) => enrollmentService.cancel(curriculumId)
export const getMyEnrollments = () => enrollmentService.getMyEnrollments()
export const getInstructorEnrollmentRoster = (curriculumId: string, query?: EnrollmentRosterQuery) =>
  enrollmentService.getInstructorRoster(curriculumId, query)

export function transitionEnrollment(
  curriculumId: string,
  enrollmentId: string,
  action: InstructorEnrollmentAction,
) {
  return enrollmentService[action](curriculumId, enrollmentId)
}

export { httpEnrollmentService } from './httpEnrollmentService'
export type { EnrollmentService } from './enrollmentService.interface'
