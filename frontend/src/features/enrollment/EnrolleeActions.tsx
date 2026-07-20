import { Link } from 'react-router-dom'
import type { CurriculumDetailResponse } from '@/features/curriculum/types'
import { resolveLessonPath } from '@/features/lesson/lessonRouting'

interface EnrolleeActionsProps {
  detail: CurriculumDetailResponse
}

export default function EnrolleeActions({ detail }: EnrolleeActionsProps) {
  const lastLearning = detail.viewerContext.progress?.lastLearning
  const lessonLocations = detail.outline.flatMap((section) =>
    section.lessons.map((lesson) => ({ sectionId: section.sectionId, lesson })),
  )
  const lastLearningLocation = lastLearning
    ? lessonLocations.find(({ lesson }) => lesson.lessonId === lastLearning.lessonId)
    : null
  const firstLessonLocation = lessonLocations[0]

  const target = lastLearningLocation
    ? { ...lastLearningLocation, label: '이어보기' }
    : firstLessonLocation
      ? { ...firstLessonLocation, label: '수강하기' }
      : null

  return (
    <div className="relation-panel enrollee-actions">
      <h2>수강 중이에요</h2>
      <p>목차에서 원하는 레슨으로 바로 이동할 수 있어요.</p>
      {target && (
        <Link
          className="button button--primary"
          to={resolveLessonPath({
            curriculumId: detail.curriculumId,
            sectionId: target.sectionId,
            lessonId: target.lesson.lessonId,
            destination: 'LESSON_DETAIL',
          })}
        >
          {target.label}
        </Link>
      )}
    </div>
  )
}
