import GuestActions from '@/features/auth/GuestActions'
import InstructorActions from '@/features/curriculum/InstructorActions'
import type { CourseDetailResponse } from '@/features/curriculum/types'
import EnrolleeActions from '@/features/enrollment/EnrolleeActions'
import EnrollmentActions from '@/features/enrollment/EnrollmentActions'
import EnrollmentPendingNotice from '@/features/enrollment/EnrollmentPendingNotice'
import NonOwnerInstructorNotice from '@/features/enrollment/NonOwnerInstructorNotice'

interface CurriculumRelationPanelProps {
  detail: CourseDetailResponse
  returnTo: string
  onEnroll: () => void
  isEnrolling: boolean
  enrollError: string | null
  onCancel: () => void
  isCancelling: boolean
  cancelError: string | null
}

export default function CurriculumRelationPanel({
  detail,
  returnTo,
  onEnroll,
  isEnrolling,
  enrollError,
  onCancel,
  isCancelling,
  cancelError,
}: CurriculumRelationPanelProps) {
  switch (detail.viewerContext.relationship) {
    case 'OWNER_INSTRUCTOR':
      return <InstructorActions detail={detail} />
    case 'ENROLLED':
      return <EnrolleeActions detail={detail} />
    case 'UNENROLLED_STUDENT':
      return (
        <EnrollmentActions detail={detail} onEnroll={onEnroll} isEnrolling={isEnrolling} error={enrollError} />
      )
    case 'PENDING_ENROLLMENT':
      return (
        <EnrollmentPendingNotice
          detail={detail}
          onCancel={onCancel}
          isCancelling={isCancelling}
          cancelError={cancelError}
        />
      )
    case 'NON_OWNER_INSTRUCTOR':
      return <NonOwnerInstructorNotice detail={detail} onEnroll={onEnroll} isEnrolling={isEnrolling} />
    case 'GUEST':
      return <GuestActions returnTo={returnTo} />
    default:
      return null
  }
}
