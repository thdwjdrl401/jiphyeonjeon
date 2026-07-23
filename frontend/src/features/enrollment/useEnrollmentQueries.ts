import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getInstructorEnrollmentRoster, getMyEnrollments } from './enrollmentService'
import type { EnrollmentRosterQuery } from './types'

export const enrollmentQueryKeys = {
  all: ['enrollments'] as const,
  mine: (userId: string) => ['enrollments', 'mine', userId] as const,
  roster: (curriculumId: string, query: EnrollmentRosterQuery) =>
    ['enrollments', 'roster', curriculumId, query.status ?? 'ALL', query.page ?? 0, query.size ?? 20] as const,
}

export function useMyEnrollmentsQuery(userId: string, enabled = true) {
  return useQuery({
    queryKey: enrollmentQueryKeys.mine(userId),
    queryFn: getMyEnrollments,
    enabled: Boolean(userId) && enabled,
  })
}

export function useInstructorEnrollmentRosterQuery(
  curriculumId: string,
  query: EnrollmentRosterQuery,
  enabled = true,
) {
  return useQuery({
    queryKey: enrollmentQueryKeys.roster(curriculumId, query),
    queryFn: () => getInstructorEnrollmentRoster(curriculumId, query),
    enabled: Boolean(curriculumId) && enabled,
    placeholderData: keepPreviousData,
  })
}
