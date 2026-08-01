import { useState } from 'react'
import CurriculumSection from './CurriculumSection'
import type { CurriculumOutlineSection, CurriculumRelationship } from './types'

interface CurriculumOutlineProps {
  outline: CurriculumOutlineSection[]
  relationship: CurriculumRelationship
  curriculumId: string
}

export default function CurriculumOutline({ outline, relationship, curriculumId }: CurriculumOutlineProps) {
  const [expandedSectionIds, setExpandedSectionIds] = useState<Set<string>>(
    () => new Set(outline[0] ? [outline[0].sectionId] : []),
  )
  const allExpanded = outline.length > 0 && outline.every((section) => expandedSectionIds.has(section.sectionId))

  const toggleSection = (sectionId: string) => {
    setExpandedSectionIds((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  const toggleAllSections = () => {
    setExpandedSectionIds(allExpanded ? new Set() : new Set(outline.map((section) => section.sectionId)))
  }

  return (
    <section className="curriculum-outline" aria-labelledby="curriculum-outline-heading">
      <header className="curriculum-outline__header">
        <h2 id="curriculum-outline-heading">커리큘럼 목차</h2>
        {outline.length > 1 && (
          <button className="curriculum-outline__toggle-all" type="button" onClick={toggleAllSections}>
            {allExpanded ? '모두 접기' : '모두 펼치기'}
          </button>
        )}
      </header>
      <ul className="curriculum-outline__sections">
        {outline.map((section) => (
          <CurriculumSection
            key={section.sectionId}
            section={section}
            relationship={relationship}
            curriculumId={curriculumId}
            expanded={expandedSectionIds.has(section.sectionId)}
            onToggle={() => toggleSection(section.sectionId)}
          />
        ))}
      </ul>
    </section>
  )
}
