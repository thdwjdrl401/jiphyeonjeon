import { Link } from 'react-router-dom'
import type { CurriculumRelationship } from '@/features/curriculum/types'
import { resolveLessonPath } from './lessonRouting'
import type { CurriculumOutlineLesson, LessonStatus } from './types'

interface CurriculumLessonItemProps {
  lesson: CurriculumOutlineLesson
  relationship: CurriculumRelationship
  curriculumId: string
  sectionId: string
}

interface LessonActivity {
  statusLabel: string
  actionLabel: string
  tone: 'default' | 'scheduled' | 'live' | 'replay' | 'warning'
  disabled?: boolean
}

const lessonStatusLabel: Record<LessonStatus, string> = {
  DRAFT: '초안',
  AI_NOT_READY: 'AI 준비 중',
  READY: '게시 준비',
  PUBLISHED: '게시됨',
}

const reasonLabel: Record<string, string> = {
  ENROLLMENT_REQUIRED: '수강 승인 후 이용',
  LESSON_NOT_PUBLISHED: '레슨 준비 중',
  LIVE_NOT_STARTED: '라이브 예정',
  REPLAY_NOT_PUBLISHED: '다시보기 준비 중',
}

function resolveActivity(lesson: CurriculumOutlineLesson, relationship: CurriculumRelationship): LessonActivity {
  const liveStatus = lesson.liveSession?.status
  const isStudent = relationship === 'ENROLLED'

  if (liveStatus === 'LIVE') return { statusLabel: '라이브 진행 중', actionLabel: isStudent ? '입장 준비' : '라이브 운영', tone: 'live' }
  if (liveStatus === 'OPEN') return { statusLabel: '입장 가능', actionLabel: isStudent ? '입장 준비' : '사전 점검', tone: 'live' }
  if (liveStatus === 'STARTING') return { statusLabel: '라이브 준비 중', actionLabel: '상태 확인', tone: 'scheduled' }
  if (liveStatus === 'DRAFT' || liveStatus === 'SCHEDULED') {
    return { statusLabel: '라이브 예정', actionLabel: '라이브 일정 보기', tone: 'scheduled' }
  }
  if (lesson.replayStatus === 'PUBLISHED') {
    return { statusLabel: '다시보기 가능', actionLabel: '다시보기', tone: 'replay' }
  }
  if (lesson.replayStatus === 'WITHDRAWN') {
    return { statusLabel: '다시보기 비공개', actionLabel: '레슨 보기', tone: 'warning' }
  }
  if (liveStatus === 'ENDING' || liveStatus === 'ENDED' || lesson.replayStatus === 'DRAFT' || lesson.replayStatus === 'READY_FOR_REVIEW') {
    return { statusLabel: '다시보기 준비 중', actionLabel: '다시보기 준비 중', tone: 'scheduled', disabled: true }
  }
  if (liveStatus === 'CANCELLED') return { statusLabel: '라이브 취소', actionLabel: '레슨 보기', tone: 'warning' }
  if (liveStatus === 'FAILED') return { statusLabel: '일정 확인 필요', actionLabel: '레슨 보기', tone: 'warning' }
  return { statusLabel: '라이브 일정 준비 중', actionLabel: '레슨 자료 보기', tone: 'default' }
}

export default function CurriculumLessonItem({ lesson, relationship, curriculumId, sectionId }: CurriculumLessonItemProps) {
  const canOpen = lesson.access.allowed
  const isStudentView = relationship !== 'OWNER_INSTRUCTOR'
  const role = relationship === 'OWNER_INSTRUCTOR' ? 'INSTRUCTOR' : 'STUDENT'
  const detailPath = resolveLessonPath({ curriculumId, sectionId, lessonId: lesson.lessonId, destination: 'LESSON_DETAIL', role })
  const activity = resolveActivity(lesson, relationship)
  const actionPath = isStudentView
    ? detailPath
    : resolveLessonPath({
        curriculumId,
        sectionId,
        lessonId: lesson.lessonId,
        destination: lesson.access.destination,
        sessionId: lesson.liveSession?.sessionId,
        role,
      })
  const showCompleted = relationship === 'ENROLLED' && lesson.learning?.completed

  return (
    <li className={`curriculum-lesson${canOpen ? '' : ' curriculum-lesson--locked'}`}>
      <div className="curriculum-lesson__main">
        {canOpen ? <Link className="curriculum-lesson__title" to={detailPath}>{lesson.order}. {lesson.title}</Link> : <strong className="curriculum-lesson__title">{lesson.order}. {lesson.title}</strong>}
        {!isStudentView && <div className="curriculum-lesson__states">
          <span className={`curriculum-lesson__state curriculum-lesson__state--${lesson.lessonStatus.toLowerCase()}`}>{lessonStatusLabel[lesson.lessonStatus]}</span>
          {canOpen && <span className={`curriculum-lesson__state curriculum-lesson__state--${activity.tone}`}>{activity.statusLabel}</span>}
          {showCompleted && <span className="curriculum-lesson__done" aria-label="완료">✓ 완료</span>}
        </div>}
      </div>

      {!canOpen ? (
        <div className="curriculum-lesson__locked-action">
          <svg className="curriculum-lesson__lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          <span className="curriculum-lesson__reason">{(lesson.access.reasonCode && reasonLabel[lesson.access.reasonCode]) ?? '이용할 수 없어요'}</span>
        </div>
      ) : activity.disabled ? (
        <button type="button" className="curriculum-lesson__action curriculum-lesson__action--disabled" disabled>{activity.actionLabel}</button>
      ) : (
        <Link className={`curriculum-lesson__action${isStudentView ? '' : ` curriculum-lesson__action--${activity.tone}`}`} to={actionPath}>{isStudentView ? '강의 상세' : activity.actionLabel}<span aria-hidden="true"> →</span></Link>
      )}
    </li>
  )
}
