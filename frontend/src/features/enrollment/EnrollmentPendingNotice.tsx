import type { CurriculumDetailResponse } from '@/features/curriculum/types'

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

interface EnrollmentPendingNoticeProps {
  detail: CurriculumDetailResponse
  onCancel: () => void
  isCancelling: boolean
}

export default function EnrollmentPendingNotice({ detail, onCancel, isCancelling }: EnrollmentPendingNoticeProps) {
  const enrollment = detail.viewerContext.enrollment

  return (
    <section
      className="curriculum-materials enrollment-pending-notice"
      aria-labelledby="curriculum-enrollment-pending-heading"
    >
      <div className="curriculum-materials__body">
        <div className="curriculum-materials__header">
          <h2 id="curriculum-enrollment-pending-heading">승인 대기 중이에요</h2>
          <div className="curriculum-materials__actions">
            <button
              className="button button--primary curriculum-materials__open-button"
              type="button"
              aria-label={isCancelling ? '신청 취소 중' : '수강 신청 취소'}
              onClick={onCancel}
              disabled={isCancelling}
            >
              {isCancelling ? '취소 중' : '신청 취소'}
            </button>
          </div>
        </div>
        {enrollment && <p>{dateFormatter.format(new Date(enrollment.requestedAt))}에 신청했어요.</p>}
      </div>
    </section>
  )
}
