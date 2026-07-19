import type { CourseDetailResponse } from '@/features/curriculum/types'

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

interface EnrollmentPendingNoticeProps {
  detail: CourseDetailResponse
  onCancel: () => void
  isCancelling: boolean
  cancelError: string | null
}

export default function EnrollmentPendingNotice({
  detail,
  onCancel,
  isCancelling,
  cancelError,
}: EnrollmentPendingNoticeProps) {
  const enrollment = detail.viewerContext.enrollment
  const canCancel = detail.viewerContext.allowedActions.includes('CANCEL_ENROLLMENT')

  return (
    <div className="relation-panel enrollment-pending-notice" role="status">
      <h2>승인 대기 중이에요</h2>
      {enrollment && <p>{dateFormatter.format(new Date(enrollment.requestedAt))}에 신청했어요.</p>}
      {canCancel && (
        <button className="button button--ghost" type="button" onClick={onCancel} disabled={isCancelling}>
          {isCancelling ? '취소 중' : '수강 취소'}
        </button>
      )}
      {cancelError && <p className="form-error" role="alert">{cancelError}</p>}
    </div>
  )
}
