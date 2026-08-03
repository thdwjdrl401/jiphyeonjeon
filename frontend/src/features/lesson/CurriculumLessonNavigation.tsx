import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { instructorPaths, publicPaths, studentPaths } from '@/app/router/paths'
import type { UserRole } from '@/features/auth/types'
import { getCurriculumLessonNavigation } from './lessonService'

interface CurriculumLessonNavigationProps {
  curriculumId: string
  activeLessonId?: string
  role: UserRole
}

function LessonNavigationMasthead() {
  return (
    <div className="workspace-sidebar__masthead workspace-sidebar__masthead--lesson" aria-hidden="true">
      <span>LESSON</span>
      <strong>INDEX</strong>
    </div>
  )
}

export default function CurriculumLessonNavigation({ curriculumId, activeLessonId, role }: CurriculumLessonNavigationProps) {
  const curriculumQuery = useQuery({
    queryKey: ['curriculum-lesson-navigation', curriculumId, role],
    queryFn: () => getCurriculumLessonNavigation(curriculumId, role),
  })

  if (curriculumQuery.isPending) {
    return <aside className="workspace-sidebar workspace-sidebar--lesson" aria-label="커리큘럼 강의 목록"><LessonNavigationMasthead /><p className="workspace-sidebar__state">불러오는 중...</p></aside>
  }
  if (curriculumQuery.isError || !curriculumQuery.data) {
    return <aside className="workspace-sidebar workspace-sidebar--lesson" aria-label="커리큘럼 강의 목록"><LessonNavigationMasthead /><p className="workspace-sidebar__state">강의 목록을 불러오지 못했습니다.</p></aside>
  }
  const curriculum = curriculumQuery.data

  return (
    <aside className="workspace-sidebar workspace-sidebar--lesson" aria-label="커리큘럼 강의 목록">
      <LessonNavigationMasthead />
      <div className="lesson-navigation__header">
        <span>CURRICULUM</span>
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
                  ? lesson.deliveryType === 'RECORDED'
                    ? instructorPaths.recordedLesson(curriculum.curriculumId, section.sectionId, lesson.lessonId)
                    : instructorPaths.lesson(curriculum.curriculumId, section.sectionId, lesson.lessonId)
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
