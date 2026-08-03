import { Link } from 'react-router-dom'
import { instructorPaths } from '@/app/router/paths'
import type { CurriculumRelationship } from '@/features/curriculum/types'
import { resolveLessonPath } from './lessonRouting'
import type { CurriculumOutlineLesson } from './types'

interface CurriculumLessonItemProps {
  lesson: CurriculumOutlineLesson
  relationship: CurriculumRelationship
  curriculumId: string
  sectionId: string
}

interface LessonActivity {
  statusLabel: string
  tone: 'scheduled' | 'live'
}

const reasonLabel: Record<string, string> = {
  ENROLLMENT_REQUIRED: '수강 승인 후 이용',
}

function resolveActivity(lesson: CurriculumOutlineLesson): LessonActivity | null {
  const liveStatus = lesson.liveSession?.status

  if (liveStatus === 'LIVE') {
    return { statusLabel: 'LIVE', tone: 'live' }
  }
  if (liveStatus === 'SCHEDULED' || liveStatus === 'OPEN' || liveStatus === 'STARTING') {
    return { statusLabel: '라이브 예정', tone: 'scheduled' }
  }
  return null
}

export default function CurriculumLessonItem({ lesson, relationship, curriculumId, sectionId }: CurriculumLessonItemProps) {
  const canOpen = lesson.access.allowed
  const role = relationship === 'OWNER_INSTRUCTOR' ? 'INSTRUCTOR' : 'STUDENT'
  const detailPath = resolveLessonPath({ curriculumId, sectionId, lessonId: lesson.lessonId, destination: 'LESSON_DETAIL', role })
  const activity = resolveActivity(lesson)
  const isInstructorView = relationship === 'OWNER_INSTRUCTOR'
  const editPath = instructorPaths.editLesson(curriculumId, sectionId, lesson.lessonId)

  const lessonMain = (
    <div className="curriculum-lesson__main">
      {canOpen && !isInstructorView
        ? <Link className="curriculum-lesson__title" to={detailPath}>{lesson.order}. {lesson.title}</Link>
        : <strong className="curriculum-lesson__title">{lesson.order}. {lesson.title}</strong>}
      {/* 일정이 잡힌 라이브와 실제 방송 중인 라이브만 표시한다. 종료 상태에는 태그를 남기지 않는다. */}
      {isInstructorView && canOpen && activity && <div className="curriculum-lesson__states">
        <span className={`curriculum-lifecycle-badge curriculum-lesson__state curriculum-lesson__state--${activity.tone}`}>{activity.statusLabel}</span>
      </div>}
    </div>
  )

  return (
    <li className={`curriculum-lesson${canOpen ? '' : ' curriculum-lesson--locked'}`}>
      {isInstructorView && canOpen
        ? (
            <Link
              className="curriculum-lesson__detail-area"
              to={detailPath}
              aria-label={`${lesson.order}. ${lesson.title} 강의 상세`}
            >
              {lessonMain}
            </Link>
          )
        : lessonMain}

      {!canOpen ? (
        <div className="curriculum-lesson__locked-action">
          <svg className="curriculum-lesson__lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          <span className="curriculum-lesson__reason">{(lesson.access.reasonCode && reasonLabel[lesson.access.reasonCode]) ?? '이용할 수 없어요'}</span>
        </div>
      ) : (
        <Link className="curriculum-lesson__action" to={isInstructorView ? editPath : detailPath}>
          {isInstructorView ? '강의 수정' : '강의 상세'}
          {!isInstructorView && <span aria-hidden="true"> →</span>}
        </Link>
      )}
    </li>
  )
}
