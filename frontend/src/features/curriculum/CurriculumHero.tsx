import type { ReactNode } from 'react'
import type { CurriculumDetailResponse } from './types'
import type { PrimaryAction } from '@/features/curriculum-detail/primaryAction'
import CurriculumIdentity from './CurriculumIdentity'
import CurriculumMetadata from './CurriculumMetadata'
import CurriculumPrimaryAction from './CurriculumPrimaryAction'

interface CurriculumHeroProps {
  detail: CurriculumDetailResponse
  primaryAction: PrimaryAction
  onCancel: () => void
  isCancelling: boolean
  reminderControl?: ReactNode
}

const lifecycleLabel: Record<string, string> = {
  PUBLISHED: '공개 중',
  DRAFT: '준비 중',
  CLOSED: '운영 종료',
}

export default function CurriculumHero({
  detail,
  primaryAction,
  onCancel,
  isCancelling,
  reminderControl,
}: CurriculumHeroProps) {
  return (
    <section className="curriculum-hero">
      <div className="curriculum-hero__grid">
        <CurriculumIdentity title={detail.title} summary={detail.summary} />
        <div className="curriculum-hero__status">
          {reminderControl}
          <span className="curriculum-lifecycle-badge">
            {lifecycleLabel[detail.lifecycleStatus] ?? detail.lifecycleStatus}
          </span>
        </div>
        <CurriculumMetadata
          instructor={detail.instructor}
          period={detail.period}
          sectionCount={detail.outline.length}
          lessonCount={detail.outline.reduce((sum, section) => sum + section.lessons.length, 0)}
        />
        <CurriculumPrimaryAction action={primaryAction} onCancel={onCancel} isCancelling={isCancelling} />
      </div>
    </section>
  )
}
