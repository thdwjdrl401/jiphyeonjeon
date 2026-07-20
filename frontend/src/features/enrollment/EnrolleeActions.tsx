import { Link } from 'react-router-dom'
import type { CourseDetailResponse } from '@/features/curriculum/types'
import { resolveLessonPath } from '@/features/lesson/lessonRouting'

interface EnrolleeActionsProps {
  detail: CourseDetailResponse
}

export default function EnrolleeActions({ detail }: EnrolleeActionsProps) {
  const lastLearning = detail.viewerContext.progress?.lastLearning
  const firstLesson = detail.outline[0]?.lessons[0]

  const target = lastLearning
    ? { lessonId: lastLearning.lessonId, label: '이어보기' }
    : firstLesson
      ? { lessonId: firstLesson.lessonId, label: '수강하기' }
      : null

  return (
    <div className="relation-panel enrollee-actions">
      <h2>수강 중이에요</h2>
      <p>목차에서 원하는 레슨으로 바로 이동할 수 있어요.</p>
      {target && (
        <Link className="button button--primary" to={resolveLessonPath(detail.courseId, target.lessonId, 'LESSON_DETAIL')}>
          {target.label}
        </Link>
      )}
    </div>
  )
}
