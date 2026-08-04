import { Link } from 'react-router-dom'
import type { CurriculumRelationship } from '@/features/curriculum/types'
import { resolveInstructorLessonEditPath, resolveLessonPath } from './lessonRouting'
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
  const detailPath = resolveLessonPath({
    curriculumId,
    sectionId,
    lessonId: lesson.lessonId,
    // 기존 목차는 라이브·다시보기도 먼저 강의 상세를 연다. ADR-0012의 업로드 녹화강의만
    // 완성 패키지 재생 화면으로 직접 이동한다.
    destination: lesson.access.destination === 'RECORDED_VOD' ? 'RECORDED_VOD' : 'LESSON_DETAIL',
    role,
    deliveryType: lesson.deliveryType,
  })
  const activity = resolveActivity(lesson)
  const isInstructorView = relationship === 'OWNER_INSTRUCTOR'
  const editPath = resolveInstructorLessonEditPath({
    curriculumId,
    sectionId,
    lessonId: lesson.lessonId,
    deliveryType: lesson.deliveryType,
  })
  const unavailableReason = (lesson.access.reasonCode && reasonLabel[lesson.access.reasonCode]) ?? '이용할 수 없어요'

  const lessonMain = (
    <div className="curriculum-lesson__main">
      <strong className="curriculum-lesson__title">{lesson.order}. {lesson.title}</strong>
      {/* 일정이 잡힌 라이브와 실제 방송 중인 라이브만 표시한다. 종료 상태에는 태그를 남기지 않는다. */}
      {activity && <div className="curriculum-lesson__states">
        <span className={`curriculum-lifecycle-badge curriculum-lesson__state curriculum-lesson__state--${activity.tone}`}>{activity.statusLabel}</span>
      </div>}
    </div>
  )

  return (
    <li className="curriculum-lesson">
      {canOpen ? (
        <Link
          className="curriculum-lesson__detail-area"
          to={detailPath}
          aria-label={`${lesson.order}. ${lesson.title} 강의 상세`}
        >
          {lessonMain}
        </Link>
      ) : (
        <div className="curriculum-lesson__detail-area curriculum-lesson__detail-area--disabled" aria-disabled="true" title={unavailableReason}>
          {lessonMain}
        </div>
      )}

      {isInstructorView && canOpen && <Link className="curriculum-lesson__action" to={editPath}>강의 수정</Link>}
    </li>
  )
}
