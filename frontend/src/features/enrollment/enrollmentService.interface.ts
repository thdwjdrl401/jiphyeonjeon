import type {
  EnrollResult,
  EnrollmentRosterQuery,
  EnrollmentRosterResponse,
  StudentCurriculumItem,
} from './types'

export interface EnrollmentService {
  apply: (curriculumId: string) => Promise<EnrollResult>
  cancel: (curriculumId: string) => Promise<EnrollResult>
  getMyEnrollments: () => Promise<StudentCurriculumItem[]>
  getInstructorRoster: (
    curriculumId: string,
    query?: EnrollmentRosterQuery,
  ) => Promise<EnrollmentRosterResponse>
  approve: (curriculumId: string, enrollmentId: string) => Promise<EnrollResult>
  reject: (curriculumId: string, enrollmentId: string) => Promise<EnrollResult>
  revoke: (curriculumId: string, enrollmentId: string) => Promise<EnrollResult>
}
