import { Link } from 'react-router-dom'

interface LessonBreadcrumbsProps {
  curriculumTitle: string
  curriculumPath?: string
  sectionTitle: string
  lessonTitle: string
  lessonPath?: string
}

/** 커리큘럼 → 섹션 → 강의로 이어지는 강의 화면 공통 경로 표시. */
export default function LessonBreadcrumbs({
  curriculumTitle,
  curriculumPath,
  sectionTitle,
  lessonTitle,
  lessonPath,
}: LessonBreadcrumbsProps) {
  const curriculum = curriculumTitle || '커리큘럼'
  const section = sectionTitle || '섹션'
  const lesson = lessonTitle || '강의'

  return (
    <nav className="breadcrumbs lesson-breadcrumbs" aria-label="강의 경로">
      {curriculumPath
        ? <Link className="lesson-breadcrumbs__curriculum" title={curriculum} to={curriculumPath}>{curriculum}</Link>
        : <span className="lesson-breadcrumbs__curriculum">{curriculum}</span>}
      <span className="lesson-breadcrumbs__separator" aria-hidden="true">/</span>
      <span className="lesson-breadcrumbs__section" title={section}>{section}</span>
      <span className="lesson-breadcrumbs__separator" aria-hidden="true">/</span>
      {lessonPath
        ? <Link className="lesson-breadcrumbs__lesson" title={lesson} to={lessonPath}>{lesson}</Link>
        : <strong className="lesson-breadcrumbs__lesson" aria-current="page" title={lesson}>{lesson}</strong>}
    </nav>
  )
}
