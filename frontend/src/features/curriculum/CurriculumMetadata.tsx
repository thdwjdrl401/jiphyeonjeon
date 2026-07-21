import type { CurriculumDetailPeriod } from './types'

interface CurriculumMetadataProps {
  instructorName: string
  period: CurriculumDetailPeriod | null
  sectionCount: number
  lessonCount: number
}

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

export default function CurriculumMetadata({
  instructorName,
  period,
  sectionCount,
  lessonCount,
}: CurriculumMetadataProps) {
  const periodLabel = period
    ? `${dateFormatter.format(new Date(period.startsAt))} – ${dateFormatter.format(new Date(period.endsAt))}`
    : '일정 준비 중'

  return (
    <dl className="curriculum-metadata">
      <div>
        <dt>강사</dt>
        <dd>{instructorName}</dd>
      </div>
      <div>
        <dt>기간</dt>
        <dd>{periodLabel}</dd>
      </div>
      <div>
        <dt>구성</dt>
        <dd>{sectionCount}개 섹션 · {lessonCount}개 레슨</dd>
      </div>
    </dl>
  )
}
