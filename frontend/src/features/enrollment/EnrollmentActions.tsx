import type { CurriculumDetailResponse } from '@/features/curriculum/types'

interface EnrollmentActionsProps {
  detail: CurriculumDetailResponse
  onEnroll: () => void
  isEnrolling: boolean
}

const policyLabel: Record<string, string> = {
  IMMEDIATE: '신청 즉시 수강을 시작할 수 있어요.',
  APPROVAL_REQUIRED: '신청 후 승인을 거치면 수강할 수 있어요.',
  INVITATION_ONLY: '초대받은 사용자만 신청할 수 있어요.',
}

export default function EnrollmentActions({ detail, onEnroll, isEnrolling }: EnrollmentActionsProps) {
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
      {/* 신청 실패 알림은 useEnrollMutation이 토스트로 낸다 — 여기서 중복 표시하지 않는다. */}
    </div>
  )
}
