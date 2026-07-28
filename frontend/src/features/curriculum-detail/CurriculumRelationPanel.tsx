import GuestActions from '@/features/auth/GuestActions'
import InstructorActions from '@/features/curriculum/InstructorActions'
import type { CurriculumDetailResponse } from '@/features/curriculum/types'
import EnrolleeActions from '@/features/enrollment/EnrolleeActions'
import EnrollmentActions from '@/features/enrollment/EnrollmentActions'
import EnrollmentPendingNotice from '@/features/enrollment/EnrollmentPendingNotice'
import NonOwnerInstructorNotice from '@/features/enrollment/NonOwnerInstructorNotice'

interface CurriculumRelationPanelProps {
  detail: CurriculumDetailResponse
  returnTo: string
  onEnroll: () => void
  isEnrolling: boolean
}

export default function CurriculumRelationPanel({
  detail,
  returnTo,
  onEnroll,
  isEnrolling,
}: CurriculumRelationPanelProps) {
  switch (detail.viewerContext.relationship) {
    case 'OWNER_INSTRUCTOR':
      return <InstructorActions detail={detail} />
    case 'ENROLLED':
      return <EnrolleeActions detail={detail} />
    case 'UNENROLLED_STUDENT':
      return (
        <EnrollmentActions detail={detail} onEnroll={onEnroll} isEnrolling={isEnrolling} />
      )
    case 'PENDING_ENROLLMENT':
      return <EnrollmentPendingNotice detail={detail} />
    case 'NON_OWNER_INSTRUCTOR':
      return <NonOwnerInstructorNotice detail={detail} onEnroll={onEnroll} isEnrolling={isEnrolling} />
    case 'GUEST':
      return <GuestActions returnTo={returnTo} />
    default:
      return null
  }
}
