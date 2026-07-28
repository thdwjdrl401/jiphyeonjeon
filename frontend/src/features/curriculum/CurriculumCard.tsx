import { Link } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import CurriculumCoverFallback from './CurriculumCoverFallback'
import type { CurriculumCardSummary } from './types'

interface CurriculumCardProps {
  curriculum: CurriculumCardSummary
  compact?: boolean
}

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: 'short',
  day: 'numeric',
})

function getPrimaryAction(curriculum: CurriculumCardSummary) {
  const actions = curriculum.viewerContext.allowedActions
  if (actions.includes('MANAGE_CURRICULUM')) {
    return { label: '커리큘럼 상세', to: publicPaths.curriculum(curriculum.curriculumId) }
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
          <CurriculumCoverFallback />
        )}
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
          <span>{curriculum.sectionCount}개 섹션 · {curriculum.lessonCount}개 강의</span>
          <Link className="text-link" to={action.to}>
            {action.label}<span aria-hidden="true"> →</span>
          </Link>
        </div>
      </div>
    </article>
  )
}
