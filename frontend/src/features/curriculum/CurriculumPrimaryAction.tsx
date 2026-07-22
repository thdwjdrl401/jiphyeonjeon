import { Link } from 'react-router-dom'
import type { PrimaryAction } from '@/features/curriculum-detail/primaryAction'

interface CurriculumPrimaryActionProps {
  action: PrimaryAction
  onEnroll: () => void
  isEnrolling: boolean
  onCancel: () => void
  isCancelling: boolean
  cancelError: string | null
}

export default function CurriculumPrimaryAction({ action, onEnroll, isEnrolling, onCancel, isCancelling, cancelError }: CurriculumPrimaryActionProps) {
  if (!action) return null

  if (action.kind === 'link') {
    return (
      <Link className="button button--primary button--large curriculum-primary-action" to={action.to}>
        {action.label}
      </Link>
    )
  }

  if (action.kind === 'enroll') {
    return (
      <button
        className="button button--primary button--large curriculum-primary-action"
        type="button"
        onClick={onEnroll}
        disabled={isEnrolling}
      >
        {isEnrolling ? <><span className="spinner spinner--light" aria-hidden="true" /> 신청 중</> : action.label}
      </button>
    )
  }

  if (action.kind === 'enrollmentStatus') {
    return (
      <div className="curriculum-primary-action-group">
        <button className="button button--ghost" type="button" disabled aria-disabled="true">{action.label}</button>
        <button className="button button--ghost" type="button" onClick={onCancel} disabled={isCancelling}>
          {isCancelling ? '취소 중' : action.cancelLabel}
        </button>
        {cancelError && <p className="form-error" role="alert">{cancelError}</p>}
      </div>
    )
  }

  return (
    <button className="button button--soft button--large curriculum-primary-action" type="button" disabled>
      {action.label}
    </button>
  )
}
