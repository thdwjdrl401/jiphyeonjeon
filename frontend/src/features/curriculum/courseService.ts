import { apiClient } from '@/shared/api/client'
import { isMockApiEnabled } from '@/shared/config/runtime'
import { getMockCourses } from './mockCourses'
import type { CourseListQuery, CourseListResponse } from './types'

export async function getCourses(query: CourseListQuery) {
  if (isMockApiEnabled) return getMockCourses(query)
  const { data } = await apiClient.get<CourseListResponse>('/courses', {
    params: query,
  })
  return data
}
