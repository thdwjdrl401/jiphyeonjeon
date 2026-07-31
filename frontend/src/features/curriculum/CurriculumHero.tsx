import type { CurriculumDetailResponse } from './types'
import type { PrimaryAction } from '@/features/curriculum-detail/primaryAction'
import CurriculumIdentity from './CurriculumIdentity'
import CurriculumMetadata from './CurriculumMetadata'
import CurriculumPrimaryAction from './CurriculumPrimaryAction'

interface CurriculumHeroProps {
  detail: CurriculumDetailResponse
  primaryAction: PrimaryAction
  onEnroll: () => void
  isEnrolling: boolean
  onCancel: () => void
  isCancelling: boolean
}

const lifecycleLabel: Record<string, string> = {
  PUBLISHED: '공개 중',
  DRAFT: '준비 중',
  CLOSED: '운영 종료',
}

export default function CurriculumHero({ detail, primaryAction, onEnroll, isEnrolling, onCancel, isCancelling }: CurriculumHeroProps) {
  return (
    <section className="curriculum-hero">
      <div className="curriculum-hero__grid">
        <CurriculumIdentity title={detail.title} summary={detail.summary} />
        <span className="curriculum-lifecycle-badge">
          {lifecycleLabel[detail.lifecycleStatus] ?? detail.lifecycleStatus}
        </span>
        <CurriculumMetadata
          instructorName={detail.instructor.displayName}
          period={detail.period}
          sectionCount={detail.outline.length}
          lessonCount={detail.outline.reduce((sum, section) => sum + section.lessons.length, 0)}
        />
        <CurriculumPrimaryAction action={primaryAction} onEnroll={onEnroll} isEnrolling={isEnrolling} onCancel={onCancel} isCancelling={isCancelling} />
      </div>
    </section>
  )
}
