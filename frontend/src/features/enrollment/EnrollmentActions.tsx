import type { CurriculumDetailResponse } from '@/features/curriculum/types'

interface EnrollmentActionsProps {
  detail: CurriculumDetailResponse
}

const policyLabel: Record<string, string> = {
  IMMEDIATE: '신청 즉시 수강을 시작할 수 있어요.',
  APPROVAL_REQUIRED: '신청 후 승인을 거치면 수강할 수 있어요.',
  INVITATION_ONLY: '초대받은 사용자만 신청할 수 있어요.',
}

export default function EnrollmentActions({ detail }: EnrollmentActionsProps) {
  const canEnroll = detail.viewerContext.allowedActions.includes('ENROLL')

  return (
    <div className="relation-panel enrollment-actions">
      <h2>수강 신청</h2>
      <p>{policyLabel[detail.enrollmentPolicy.type] ?? '수강 방식을 확인해 주세요.'}</p>
      {!canEnroll && <p>지금은 수강 신청을 받고 있지 않아요.</p>}
    </div>
  )
}
