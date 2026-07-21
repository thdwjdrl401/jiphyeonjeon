import { Link } from 'react-router-dom'
import { publicPaths, studentPaths } from '@/app/router/paths'
import { getDemoCurriculumLessonNavigation } from '@/features/demo/demoData'

interface StudentLessonNavigationProps {
  curriculumId: string
  activeLessonId: string
}

export default function StudentLessonNavigation({ curriculumId, activeLessonId }: StudentLessonNavigationProps) {
  const curriculum = getDemoCurriculumLessonNavigation(curriculumId)

  return (
    <aside className="workspace-sidebar workspace-sidebar--lesson" aria-label="커리큘럼 레슨 목록">
      <div className="lesson-navigation__header">
        <span>현재 커리큘럼</span>
        <Link to={publicPaths.curriculum(curriculum.curriculumId)}>{curriculum.title}</Link>
      </div>
      <nav className="lesson-navigation__sections" aria-label={`${curriculum.title} 레슨 이동`}>
        {curriculum.sections.map((section) => (
          <section className="lesson-navigation__section" key={section.sectionId}>
            <h2>{section.title}</h2>
            <ol className="lesson-navigation__lessons">
              {section.lessons.map((lesson) => {
                const isCurrent = lesson.lessonId === activeLessonId
                return (
                  <li key={lesson.lessonId}>
                    <Link
                      className={isCurrent ? 'is-current' : undefined}
                      aria-current={isCurrent ? 'page' : undefined}
                      to={studentPaths.lesson(curriculum.curriculumId, section.sectionId, lesson.lessonId)}
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
