import GuestActions from '@/features/auth/GuestActions'
import type { CurriculumDetailResponse } from '@/features/curriculum/types'
import EnrollmentActions from '@/features/enrollment/EnrollmentActions'
import EnrollmentPendingNotice from '@/features/enrollment/EnrollmentPendingNotice'

interface CurriculumRelationPanelProps {
  detail: CurriculumDetailResponse
  returnTo: string
}

/** 강사 관계(OWNER_INSTRUCTOR·NON_OWNER_INSTRUCTOR)는 InstructorManagementCard가 보조 정보 영역에서 처리한다. */
export default function CurriculumRelationPanel({
  detail,
  returnTo,
}: CurriculumRelationPanelProps) {
  switch (detail.viewerContext.relationship) {
    case 'ENROLLED':
      return null
    case 'UNENROLLED_STUDENT':
      return <EnrollmentActions detail={detail} />
    case 'PENDING_ENROLLMENT':
      return <EnrollmentPendingNotice detail={detail} />
    case 'GUEST':
      return <GuestActions returnTo={returnTo} />
    default:
      return null
  }
}
