import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getCourses } from './courseService'
import type { CourseListQuery } from './types'

export function useCourses(query: CourseListQuery, viewerId?: string) {
  return useQuery({
    queryKey: ['courses', query, viewerId ?? 'guest'],
    queryFn: () => getCourses(query),
    placeholderData: keepPreviousData,
  })
}
