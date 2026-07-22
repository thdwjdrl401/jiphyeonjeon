import { Link } from 'react-router-dom'
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
  tone: 'default' | 'scheduled' | 'replay'
}

const reasonLabel: Record<string, string> = {
  ENROLLMENT_REQUIRED: '수강 승인 후 이용',
  LESSON_NOT_PUBLISHED: '강의 준비 중',
  LIVE_NOT_STARTED: '라이브 예정',
  REPLAY_NOT_PUBLISHED: '다시보기 준비 중',
}

function resolveActivity(lesson: CurriculumOutlineLesson): LessonActivity {
  const liveStatus = lesson.liveSession?.status

  if (lesson.replayStatus === 'PUBLISHED') {
    return { statusLabel: '다시보기 가능', tone: 'replay' }
  }
  if (liveStatus === 'ENDING' || liveStatus === 'ENDED' || lesson.replayStatus === 'DRAFT' || lesson.replayStatus === 'READY_FOR_REVIEW') {
    return { statusLabel: '다시보기 준비 중', tone: 'scheduled' }
  }
  if (liveStatus && !['DRAFT', 'CANCELLED', 'FAILED'].includes(liveStatus)) {
    return { statusLabel: '라이브 예정', tone: 'scheduled' }
  }
  return { statusLabel: '라이브 일정 준비 중', tone: 'default' }
}

export default function CurriculumLessonItem({ lesson, relationship, curriculumId, sectionId }: CurriculumLessonItemProps) {
  const canOpen = lesson.access.allowed
  const role = relationship === 'OWNER_INSTRUCTOR' ? 'INSTRUCTOR' : 'STUDENT'
  const detailPath = resolveLessonPath({ curriculumId, sectionId, lessonId: lesson.lessonId, destination: 'LESSON_DETAIL', role })
  const activity = resolveActivity(lesson)
  const isStudentView = relationship !== 'OWNER_INSTRUCTOR'
  const publicationLabel = lesson.lessonStatus === 'PUBLISHED' ? '게시됨' : '준비 중'
  const publicationTone = lesson.lessonStatus === 'PUBLISHED' ? 'published' : 'default'

  return (
    <li className={`curriculum-lesson${canOpen ? '' : ' curriculum-lesson--locked'}`}>
      <div className="curriculum-lesson__main">
        {canOpen ? <Link className="curriculum-lesson__title" to={detailPath}>{lesson.order}. {lesson.title}</Link> : <strong className="curriculum-lesson__title">{lesson.order}. {lesson.title}</strong>}
        {!isStudentView && <div className="curriculum-lesson__states">
          <span className={`curriculum-lesson__state curriculum-lesson__state--${publicationTone}`}>{publicationLabel}</span>
          {canOpen && <span className={`curriculum-lesson__state curriculum-lesson__state--${activity.tone}`}>{activity.statusLabel}</span>}
        </div>}
      </div>

      {!canOpen ? (
        <div className="curriculum-lesson__locked-action">
          <svg className="curriculum-lesson__lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          <span className="curriculum-lesson__reason">{(lesson.access.reasonCode && reasonLabel[lesson.access.reasonCode]) ?? '이용할 수 없어요'}</span>
        </div>
      ) : (
        <Link className="curriculum-lesson__action" to={detailPath}>강의 상세<span aria-hidden="true"> →</span></Link>
      )}
    </li>
  )
}
