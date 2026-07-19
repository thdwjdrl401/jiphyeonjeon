import { Link } from 'react-router-dom'
import type { CourseDetailResponse } from './types'

interface InstructorActionsProps {
  detail: CourseDetailResponse
}

export default function InstructorActions({ detail }: InstructorActionsProps) {
  return (
    <div className="relation-panel instructor-actions">
      <h2>담당 강사 관리</h2>
      <p>이 커리큘럼을 관리하고 레슨을 편성할 수 있어요.</p>
      <div className="instructor-actions__buttons">
        <Link className="button button--primary" to={`/curriculums/${detail.courseId}/manage`}>
          커리큘럼 관리
        </Link>
      </div>
    </div>
  )
}
