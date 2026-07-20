import { Link } from 'react-router-dom'
import type { CurriculumRelationship } from '@/features/curriculum/types'
import { resolveLessonPath } from './lessonRouting'
import type { CurriculumOutlineLesson } from './types'

interface CurriculumLessonItemProps {
  lesson: CurriculumOutlineLesson
  relationship: CurriculumRelationship
  curriculumId: string
}

const reasonLabel: Record<string, string> = {
  ENROLLMENT_REQUIRED: '수강 후 이용 가능',
  LESSON_NOT_PUBLISHED: '준비 중',
  LIVE_NOT_STARTED: '라이브 시작 전',
  REPLAY_NOT_PUBLISHED: '다시보기 준비 중',
}

export default function CurriculumLessonItem({ lesson, curriculumId }: CurriculumLessonItemProps) {
  const canOpen = lesson.access.allowed

  if (canOpen) {
    return (
      <li className="curriculum-lesson">
        <Link to={resolveLessonPath(curriculumId, lesson.lessonId, lesson.access.destination)}>
          <span>{lesson.order}. {lesson.title}</span>
          {lesson.learning?.completed && <span className="curriculum-lesson__done" aria-label="완료">완료</span>}
        </Link>
        {lesson.learning?.completed && (
          <Link
            className="button button--soft button--small curriculum-lesson__replay"
            to={resolveLessonPath(curriculumId, lesson.lessonId, 'VOD')}
          >
            다시보기
          </Link>
        )}
      </li>
    )
  }

  return (
    <li className="curriculum-lesson curriculum-lesson--locked">
      <span>{lesson.order}. {lesson.title}</span>
      <svg className="curriculum-lesson__lock" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <span className="curriculum-lesson__reason">
        {(lesson.access.reasonCode && reasonLabel[lesson.access.reasonCode]) ?? '이용할 수 없어요'}
      </span>
    </li>
  )
}
