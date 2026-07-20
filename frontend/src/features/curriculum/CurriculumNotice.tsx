import type { CourseDetailResponse } from './types'

interface CurriculumNoticeProps {
  detail: CourseDetailResponse
}

export default function CurriculumNotice({ detail }: CurriculumNoticeProps) {
  const restrictions = detail.viewerContext.actionRestrictions ?? []
  const isClosed = detail.enrollmentPolicy.status !== 'OPEN'

  if (!isClosed && restrictions.length === 0) return null

  return (
    <div className="curriculum-notice" role="status">
      {isClosed && <p>현재 모집이 진행 중이 아니에요.</p>}
      {restrictions.map((restriction) => (
        <p key={restriction.action}>{restriction.reasonCode}</p>
      ))}
    </div>
  )
}
