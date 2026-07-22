import { Link } from 'react-router-dom'
import { instructorPaths } from '@/app/router/paths'
import type { CurriculumDetailResponse } from './types'

interface InstructorActionsProps {
  detail: CurriculumDetailResponse
}

export default function InstructorActions({ detail }: InstructorActionsProps) {
  return (
    <div className="relation-panel instructor-actions">
      <h2>담당 강사 관리</h2>
      <p>이 커리큘럼을 관리하고 강의를 편성할 수 있어요.</p>
      <div className="instructor-actions__buttons">
        <Link className="button button--primary" to={instructorPaths.curriculumManage(detail.curriculumId)}>
          커리큘럼 관리
        </Link>
      </div>
    </div>
  )
}
