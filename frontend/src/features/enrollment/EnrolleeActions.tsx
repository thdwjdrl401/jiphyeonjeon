import type { CurriculumDetailResponse } from '@/features/curriculum/types'

interface EnrolleeActionsProps {
  detail: CurriculumDetailResponse
}

export default function EnrolleeActions({ detail }: EnrolleeActionsProps) {
  return (
    <div className="relation-panel enrollee-actions">
      <h2>수강 중이에요</h2>
      <p>{detail.title}의 목차에서 원하는 강의 상세로 이동할 수 있어요.</p>
    </div>
  )
}
