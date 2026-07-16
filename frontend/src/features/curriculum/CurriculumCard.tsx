import { Link } from 'react-router-dom'
import type { CourseCardSummary } from './types'

interface CurriculumCardProps {
  course: CourseCardSummary
  compact?: boolean
}

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: 'short',
  day: 'numeric',
})

function getCoverVariant(courseId: string) {
  return [...courseId].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 6
}

function getPrimaryAction(course: CourseCardSummary) {
  const actions = course.viewerContext.allowedActions
  if (actions.includes('MANAGE_COURSE')) {
    return { label: '관리하기', to: `/curriculums/${course.courseId}/manage` }
  }
  if (actions.includes('CONTINUE_LEARNING')) {
    return { label: '학습 계속하기', to: `/curriculums/${course.courseId}` }
  }
  return { label: '상세 보기', to: `/curriculums/${course.courseId}` }
}

export default function CurriculumCard({ course, compact = false }: CurriculumCardProps) {
  const action = getPrimaryAction(course)
  const progress = course.viewerContext.progress
  const period = course.period
    ? `${dateFormatter.format(new Date(course.period.startsAt))} – ${dateFormatter.format(new Date(course.period.endsAt))}`
    : '일정 준비 중'

  return (
    <article className={`curriculum-card${compact ? ' curriculum-card--compact' : ''}`}>
      <Link className="curriculum-cover" to={`/curriculums/${course.courseId}`} tabIndex={-1} aria-hidden="true">
        {course.thumbnailUrl ? (
          <img src={course.thumbnailUrl} alt="" />
        ) : (
          <div className={`course-art course-art--${getCoverVariant(course.courseId)}`}>
            <span className="course-art__grid" />
            <span className="course-art__orb" />
            <strong>{course.title.slice(0, 2)}</strong>
          </div>
        )}
        <span className="status-badge">공개 중</span>
      </Link>

      <div className="curriculum-card__body">
        <div className="curriculum-card__meta">
          <span>{course.instructor.displayName} 강사</span>
          <span>{period}</span>
        </div>
        <h3>
          <Link to={`/curriculums/${course.courseId}`}>{course.title}</Link>
        </h3>
        <p>{course.summary}</p>

        {progress && (
          <div className="course-progress">
            <div>
              <span>학습 진행률</span>
              <strong>{progress.progressPercent}%</strong>
            </div>
            <span className="progress-track" aria-hidden="true">
              <span style={{ width: `${progress.progressPercent}%` }} />
            </span>
          </div>
        )}

        <div className="curriculum-card__footer">
          <span>{course.sectionCount}개 섹션 · {course.lessonCount}개 레슨</span>
          <Link className="text-link" to={action.to}>
            {action.label}<span aria-hidden="true"> →</span>
          </Link>
        </div>
      </div>
    </article>
  )
}
