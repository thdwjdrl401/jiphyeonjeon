import type { CourseDetailResponse } from './types'
import type { PrimaryAction } from '@/features/curriculum-detail/primaryAction'
import CurriculumIdentity from './CurriculumIdentity'
import CurriculumMetadata from './CurriculumMetadata'
import CurriculumPrimaryAction from './CurriculumPrimaryAction'

interface CurriculumHeroProps {
  detail: CourseDetailResponse
  primaryAction: PrimaryAction
  onEnroll: () => void
  isEnrolling: boolean
}

export default function CurriculumHero({ detail, primaryAction, onEnroll, isEnrolling }: CurriculumHeroProps) {
  return (
    <section className="curriculum-hero">
      <div className="curriculum-hero__grid">
        <CurriculumIdentity title={detail.title} summary={detail.summary} lifecycleStatus={detail.lifecycleStatus} />
        <CurriculumMetadata
          instructorName={detail.instructor.displayName}
          period={detail.period}
          sectionCount={detail.outline.length}
          lessonCount={detail.outline.reduce((sum, section) => sum + section.lessons.length, 0)}
        />
        <CurriculumPrimaryAction action={primaryAction} onEnroll={onEnroll} isEnrolling={isEnrolling} />
      </div>
    </section>
  )
}
