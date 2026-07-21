import { Link } from 'react-router-dom'
import { instructorPaths, publicPaths } from '@/app/router/paths'
import type { CurriculumCardSummary } from './types'

interface CurriculumCardProps {
  curriculum: CurriculumCardSummary
  compact?: boolean
}

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: 'short',
  day: 'numeric',
})

function getCoverVariant(curriculumId: string) {
  return [...curriculumId].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 6
}

function getPrimaryAction(curriculum: CurriculumCardSummary) {
  const actions = curriculum.viewerContext.allowedActions
  if (actions.includes('MANAGE_CURRICULUM')) {
    return { label: '관리하기', to: instructorPaths.curriculumManage(curriculum.curriculumId) }
  }
  if (actions.includes('CONTINUE_LEARNING')) {
    return { label: '학습 계속하기', to: publicPaths.curriculum(curriculum.curriculumId) }
  }
  return { label: '상세 보기', to: publicPaths.curriculum(curriculum.curriculumId) }
}

export default function CurriculumCard({ curriculum, compact = false }: CurriculumCardProps) {
  const action = getPrimaryAction(curriculum)
  const progress = curriculum.viewerContext.progress
  const period = curriculum.period
    ? `${dateFormatter.format(new Date(curriculum.period.startsAt))} – ${dateFormatter.format(new Date(curriculum.period.endsAt))}`
    : '일정 준비 중'

  return (
    <article className={`curriculum-card${compact ? ' curriculum-card--compact' : ''}`}>
      <Link className="curriculum-cover" to={publicPaths.curriculum(curriculum.curriculumId)} tabIndex={-1} aria-hidden="true">
        {curriculum.thumbnailUrl ? (
          <img src={curriculum.thumbnailUrl} alt="" />
        ) : (
          <div className={`curriculum-art curriculum-art--${getCoverVariant(curriculum.curriculumId)}`}>
            <span className="curriculum-art__grid" />
            <span className="curriculum-art__orb" />
          </div>
        )}
        <span className="status-badge">공개 중</span>
      </Link>

      <div className="curriculum-card__body">
        <div className="curriculum-card__meta">
          <span>{curriculum.instructor.displayName} 강사</span>
          <span>{period}</span>
        </div>
        <h3>
          <Link to={publicPaths.curriculum(curriculum.curriculumId)}>{curriculum.title}</Link>
        </h3>
        <p>{curriculum.summary}</p>

        {progress && (
          <div className="curriculum-progress">
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
          <span>{curriculum.sectionCount}개 섹션 · {curriculum.lessonCount}개 레슨</span>
          <Link className="text-link" to={action.to}>
            {action.label}<span aria-hidden="true"> →</span>
          </Link>
        </div>
      </div>
    </article>
  )
}
