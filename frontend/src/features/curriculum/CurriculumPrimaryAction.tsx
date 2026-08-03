import type { PrimaryAction } from '@/features/curriculum-detail/primaryAction'

interface CurriculumPrimaryActionProps {
  action: PrimaryAction
  onCancel: () => void
  isCancelling: boolean
}

export default function CurriculumPrimaryAction({ action, onCancel, isCancelling }: CurriculumPrimaryActionProps) {
  if (!action) return null

  if (action.kind === 'enrollmentStatus') {
    return (
      <div className="curriculum-primary-action-group">
        <button className="button button--ghost" type="button" disabled aria-disabled="true">{action.label}</button>
        <button className="button button--ghost" type="button" onClick={onCancel} disabled={isCancelling}>
          {isCancelling ? '취소 중' : action.cancelLabel}
        </button>
        {/* 취소 실패 알림은 useCancelEnrollmentMutation이 토스트로 낸다. */}
      </div>
    )
  }

  return (
    <button className="button button--soft button--large curriculum-primary-action" type="button" disabled>
      {action.label}
    </button>
  )
}
