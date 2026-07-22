import { Link } from 'react-router-dom'
import { instructorPaths, publicPaths, studentPaths } from '@/app/router/paths'
import type { UserRole } from '@/features/auth/types'
import { getDemoCurriculumLessonNavigation } from '@/features/demo/demoData'

interface CurriculumLessonNavigationProps {
  curriculumId: string
  activeLessonId?: string
  role: UserRole
}

export default function CurriculumLessonNavigation({ curriculumId, activeLessonId, role }: CurriculumLessonNavigationProps) {
  const curriculum = getDemoCurriculumLessonNavigation(curriculumId)

  return (
    <aside className="workspace-sidebar workspace-sidebar--lesson" aria-label="커리큘럼 강의 목록">
      <div className="lesson-navigation__header">
        <span>현재 커리큘럼</span>
        <Link to={publicPaths.curriculum(curriculum.curriculumId)}>{curriculum.title}</Link>
      </div>
      <nav className="lesson-navigation__sections" aria-label={`${curriculum.title} 강의 이동`}>
        {curriculum.sections.map((section) => (
          <section className="lesson-navigation__section" key={section.sectionId}>
            <h2>{section.title}</h2>
            <ol className="lesson-navigation__lessons">
              {section.lessons.map((lesson) => {
                const isCurrent = lesson.lessonId === activeLessonId
                const lessonPath = role === 'INSTRUCTOR'
                  ? instructorPaths.lesson(curriculum.curriculumId, section.sectionId, lesson.lessonId)
                  : studentPaths.lesson(curriculum.curriculumId, section.sectionId, lesson.lessonId)
                return (
                  <li key={lesson.lessonId}>
                    <Link
                      className={isCurrent ? 'is-current' : undefined}
                      aria-current={isCurrent ? 'page' : undefined}
                      to={lessonPath}
                    >
                      <span>{lesson.order}</span>
                      <strong>{lesson.title}</strong>
                    </Link>
                  </li>
                )
              })}
            </ol>
          </section>
        ))}
      </nav>
    </aside>
  )
}
