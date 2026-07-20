import { useState } from 'react'
import CurriculumLessonItem from '@/features/lesson/CurriculumLessonItem'
import type { CourseRelationship, CourseSection } from './types'

interface CurriculumSectionProps {
  section: CourseSection
  relationship: CourseRelationship
  courseId: string
}

export default function CurriculumSection({ section, relationship, courseId }: CurriculumSectionProps) {
  const [expanded, setExpanded] = useState(true)

  return (
    <li className="curriculum-section">
      <div className="curriculum-section__header">
        <button
          type="button"
          className="curriculum-section__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span>{section.order}. {section.title}</span>
          <span className="curriculum-section__count">{section.lessons.length}개 레슨</span>
        </button>
      </div>
      {expanded && (
        <ul className="curriculum-section__lessons">
          {section.lessons.map((lesson) => (
            <CurriculumLessonItem
              key={lesson.lessonId}
              lesson={lesson}
              relationship={relationship}
              courseId={courseId}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
