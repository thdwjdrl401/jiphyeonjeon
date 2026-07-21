import CurriculumSection from './CurriculumSection'
import type { CurriculumOutlineSection, CurriculumRelationship } from './types'

interface CurriculumOutlineProps {
  outline: CurriculumOutlineSection[]
  relationship: CurriculumRelationship
  curriculumId: string
}

export default function CurriculumOutline({ outline, relationship, curriculumId }: CurriculumOutlineProps) {
  return (
    <section className="curriculum-outline" aria-labelledby="curriculum-outline-heading">
      <h2 id="curriculum-outline-heading">커리큘럼 목차</h2>
      <ul className="curriculum-outline__sections">
        {outline.map((section) => (
          <CurriculumSection key={section.sectionId} section={section} relationship={relationship} curriculumId={curriculumId} />
        ))}
      </ul>
    </section>
  )
}
