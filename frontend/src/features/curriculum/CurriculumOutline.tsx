import CurriculumSection from './CurriculumSection'
import type { CourseRelationship, CourseSection } from './types'

interface CurriculumOutlineProps {
  outline: CourseSection[]
  relationship: CourseRelationship
  courseId: string
}

export default function CurriculumOutline({ outline, relationship, courseId }: CurriculumOutlineProps) {
  return (
    <section className="curriculum-outline" aria-labelledby="curriculum-outline-heading">
      <h2 id="curriculum-outline-heading">커리큘럼 목차</h2>
      <ul className="curriculum-outline__sections">
        {outline.map((section) => (
          <CurriculumSection key={section.sectionId} section={section} relationship={relationship} courseId={courseId} />
        ))}
      </ul>
    </section>
  )
}
