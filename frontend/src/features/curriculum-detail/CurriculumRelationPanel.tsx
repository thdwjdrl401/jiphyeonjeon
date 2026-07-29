import GuestActions from '@/features/auth/GuestActions'
import type { CurriculumDetailResponse } from '@/features/curriculum/types'
import EnrolleeActions from '@/features/enrollment/EnrolleeActions'
import EnrollmentActions from '@/features/enrollment/EnrollmentActions'
import EnrollmentPendingNotice from '@/features/enrollment/EnrollmentPendingNotice'

interface CurriculumRelationPanelProps {
  detail: CurriculumDetailResponse
  returnTo: string
  onEnroll: () => void
  isEnrolling: boolean
}

/** 강사 관계(OWNER_INSTRUCTOR·NON_OWNER_INSTRUCTOR)는 InstructorManagementCard가 상단에서 처리한다. */
export default function CurriculumRelationPanel({
  detail,
  returnTo,
  onEnroll,
  isEnrolling,
}: CurriculumRelationPanelProps) {
  switch (detail.viewerContext.relationship) {
    case 'ENROLLED':
      return <EnrolleeActions detail={detail} />
    case 'UNENROLLED_STUDENT':
      return (
        <EnrollmentActions detail={detail} onEnroll={onEnroll} isEnrolling={isEnrolling} />
      )
    case 'PENDING_ENROLLMENT':
      return <EnrollmentPendingNotice detail={detail} />
    case 'GUEST':
      return <GuestActions returnTo={returnTo} />
    default:
      return null
  }
}
