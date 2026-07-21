import type { CurriculumDetailResponse } from '@/features/curriculum/types'

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

interface EnrollmentPendingNoticeProps {
  detail: CurriculumDetailResponse
}

export default function EnrollmentPendingNotice({ detail }: EnrollmentPendingNoticeProps) {
  const enrollment = detail.viewerContext.enrollment

  return (
    <div className="relation-panel enrollment-pending-notice" role="status">
      <h2>승인 대기 중이에요</h2>
      {enrollment && <p>{dateFormatter.format(new Date(enrollment.requestedAt))}에 신청했어요.</p>}
    </div>
  )
}
