import { apiClient } from '@/shared/api/client'
import { isMockApiEnabled } from '@/shared/config/runtime'
import type { CourseDetailResponse } from '@/features/curriculum/types'
import type { EnrollResult } from '@/features/enrollment/types'
import { cancelMockEnrollment, enrollMockCourse, getMockCourseDetail } from './mockCourseDetails'

export async function getCourseDetail(courseId: string) {
  if (isMockApiEnabled) return getMockCourseDetail(courseId)
  const { data } = await apiClient.get<CourseDetailResponse>(`/courses/${courseId}`)
  return data
}

export async function enrollInCourse(courseId: string) {
  if (isMockApiEnabled) return enrollMockCourse(courseId)
  const { data } = await apiClient.post<EnrollResult>(`/courses/${courseId}/enrollments`)
  return data
}

export async function cancelEnrollment(courseId: string) {
  if (isMockApiEnabled) return cancelMockEnrollment(courseId)
  await apiClient.delete(`/courses/${courseId}/enrollments/me`)
}
