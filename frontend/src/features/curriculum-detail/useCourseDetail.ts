import { useQuery } from '@tanstack/react-query'
import { getCourseDetail } from './courseDetailService'

export function useCourseDetail(courseId: string, viewerId?: string) {
  return useQuery({
    queryKey: ['courses', 'detail', courseId, viewerId ?? 'guest'],
    queryFn: () => getCourseDetail(courseId),
    enabled: Boolean(courseId),
  })
}
