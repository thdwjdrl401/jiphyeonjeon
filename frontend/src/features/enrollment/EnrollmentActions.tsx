import type { CourseDetailResponse } from '@/features/curriculum/types'

interface EnrollmentActionsProps {
  detail: CourseDetailResponse
  onEnroll: () => void
  isEnrolling: boolean
  error: string | null
}

const policyLabel: Record<string, string> = {
  IMMEDIATE: '신청 후 승인을 거치면 수강할 수 있어요.',
  APPROVAL_REQUIRED: '신청 후 승인을 거치면 수강할 수 있어요.',
  INVITATION_ONLY: '초대받은 사용자만 신청할 수 있어요.',
}

export default function EnrollmentActions({ detail, onEnroll, isEnrolling, error }: EnrollmentActionsProps) {
  const canEnroll = detail.viewerContext.allowedActions.includes('ENROLL')

  return (
    <div className="relation-panel enrollment-actions">
      <h2>수강 신청</h2>
      <p>{policyLabel[detail.enrollmentPolicy.type] ?? '수강 방식을 확인해 주세요.'}</p>
      {canEnroll ? (
        <button className="button button--primary" type="button" onClick={onEnroll} disabled={isEnrolling}>
          {isEnrolling ? <><span className="spinner spinner--light" aria-hidden="true" /> 신청 중</> : '수강 신청'}
        </button>
      ) : (
        <p>지금은 수강 신청을 받고 있지 않아요.</p>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
