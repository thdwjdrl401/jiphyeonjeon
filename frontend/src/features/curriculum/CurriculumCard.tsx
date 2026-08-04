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

export default function CurriculumCard({ curriculum, compact = false }: CurriculumCardProps) {
  const progress = curriculum.viewerContext.progress
  const period = curriculum.period
    ? `${dateFormatter.format(new Date(curriculum.period.startsAt))} – ${dateFormatter.format(new Date(curriculum.period.endsAt))}`
    : '일정 준비 중'

  return (
    <article className={`curriculum-card${compact ? ' curriculum-card--compact' : ''}`}>
      <Link className="curriculum-card__link" to={publicPaths.curriculum(curriculum.curriculumId)}>
        <div className="curriculum-cover" aria-hidden="true">
          {curriculum.thumbnailUrl ? (
            <img src={curriculum.thumbnailUrl} alt="" />
          ) : (
            <CurriculumCoverFallback />
          )}
        </div>

        <div className="curriculum-card__body">
          {/* 강사명은 ellipsis로, 제목은 두 줄로 잘린다 — title로 전체를 확인할 수 있게 둔다. */}
          <div className="curriculum-card__meta">
            <span title={`${curriculum.instructor.displayName} 강사`}>{curriculum.instructor.displayName} 강사</span>
            <span>{period}</span>
          </div>
          <h3 title={curriculum.title}>{curriculum.title}</h3>

          {progress ? (
            <div className="curriculum-progress">
              <div>
                <span>학습 진행률</span>
                <strong>{progress.progressPercent}%</strong>
              </div>
              <span className="progress-track" aria-hidden="true">
                <span style={{ width: `${progress.progressPercent}%` }} />
              </span>
            </div>
          ) : (
            <p>{curriculum.summary}</p>
          )}

          <div className="curriculum-card__footer">
            <span>{curriculum.sectionCount}개 섹션 · {curriculum.lessonCount}개 강의</span>
            <span className="curriculum-card__arrow" aria-hidden="true">↗</span>
          </div>
        </div>
      </Link>
    </article>
  )
}
