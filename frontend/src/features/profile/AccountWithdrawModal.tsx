import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { publicPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import type { UserRole } from '@/features/auth/types'
import { ApiError } from '@/shared/api/client'
import { InlineNotice } from '@/shared/ui/WorkspaceUi'
import { profileService } from './profileService'

interface AccountWithdrawModalProps {
  role: UserRole
  onClose: () => void
}

/**
 * 회원 탈퇴 확인 모달 — 안내 → 동의 → 실행.
 *
 * <p>안내를 카드에서 이 모달로 옮긴 것은 배치 결정이다(ADR-0011). <b>문장은 하나도 바꾸지 않았다</b> —
 * ADR-0031이 실제 서버 동작에 맞춰 고른 문구이고, 탈퇴는 하드 삭제가 아니라 소프트 삭제다:
 * `status`가 `WITHDRAWN`으로 바뀌어 로그인만 막히고, 커리큘럼·수강 기록은 남는다
 * (`curriculum.instructor_id`·`enrollment.user_id`가 CASCADE 없는 FK라 지울 수도 없고, 이미 수강한
 * 수강생을 위해 남아야 한다). 탈퇴 시 이메일을 tombstone 처리하므로 **같은 이메일로 재가입이
 * 허용된다**. 그래서 "모든 데이터가 즉시 삭제되며 복구할 수 없습니다" 류의 흔한 문구를 쓸 수 없다 —
 * 사실이 아니고, 개인정보 파기에 관한 거짓 고지가 된다.
 *
 * <p>진행 중 라이브 차단은 <b>서버가 권위</b>다(`LiveWithdrawalGuard` → 409
 * `AUTH_WITHDRAWAL_BLOCKED`). FE가 미리 판정하지 않는 이유: "이 강사에게 켜져 있는 라이브가 있는가"를
 * 한 번에 묻는 API가 없어서 커리큘럼을 전부 훑어야 하고, 훑는 사이 상태가 바뀌면 화면과 서버가
 * 어긋난다. 대신 ① 강사에게는 조건을 미리 안내하고 ② 409를 <b>이 모달 안에</b> 그대로 띄운다 —
 * 실패와 함께 모달을 닫아 버리면 왜 실패했는지가 사라지고, 사용자는 안내를 처음부터 다시 읽어야 한다.
 */
export default function AccountWithdrawModal({ role, onClose }: AccountWithdrawModalProps) {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')

  const withdrawMutation = useMutation({
    mutationFn: profileService.withdrawAccount,
    onSuccess: async () => {
      await logout()
      navigate(publicPaths.home, { replace: true })
    },
    onError: (mutationError) => {
      if (mutationError instanceof ApiError && mutationError.code === 'AUTH_WITHDRAWAL_BLOCKED') {
        setError('진행 중인 라이브 강의가 있어 탈퇴할 수 없습니다. 먼저 강의를 종료해 주세요.')
        return
      }
      setError(mutationError.message || '회원 탈퇴를 처리하지 못했습니다.')
    },
  })

  const isPending = withdrawMutation.isPending

  /*
    처리 중에는 닫히지 않는다(Esc·배경 클릭·닫기 버튼 모두). 요청이 날아간 뒤 모달만 사라지면
    탈퇴가 됐는지 안 됐는지 알 수 없는 상태로 남는다.
  */
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPending) onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isPending, onClose])

  return (
    <div
      className="profile-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isPending) onClose()
      }}
    >
      <section
        className="profile-modal withdraw-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-withdraw-title"
        aria-describedby="account-withdraw-lead"
      >
        <header className="profile-modal__header">
          <div>
            <span className="eyebrow">ACCOUNT</span>
            <h2 id="account-withdraw-title">회원 탈퇴</h2>
            <p id="account-withdraw-lead">
              회원 탈퇴 시 계정이 비활성화되어 더 이상 로그인할 수 없습니다.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            className="profile-modal__close"
            type="button"
            aria-label="회원 탈퇴 닫기"
            disabled={isPending}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="withdraw-panel">
          <ul className="withdraw-panel__notice">
            <li>강의, 커리큘럼 및 학습 기록은 서비스 운영을 위해 보존됩니다.</li>
            <li>동일한 이메일로 언제든지 다시 회원가입할 수 있습니다.</li>
            {role === 'INSTRUCTOR' && (
              <li>진행 중인 라이브 강의가 있으면 탈퇴할 수 없습니다. 먼저 강의를 종료해 주세요.</li>
            )}
          </ul>

          <label className="choice-row">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={isPending}
              onChange={(event) => {
                setConfirmed(event.target.checked)
                if (event.target.checked) setError('')
              }}
            />
            <span>위 안내 사항을 모두 확인하였으며, 이에 동의합니다.</span>
          </label>

          {error && <InlineNotice tone="danger">{error}</InlineNotice>}

          <div className="form-actions">
            <button className="button button--ghost" type="button" disabled={isPending} onClick={onClose}>
              취소
            </button>
            {/*
              카드의 진입 버튼과 이름이 겹치면 안 된다 — 둘 다 "회원 탈퇴"면 화면에 같은 이름의
              버튼이 두 개가 되고, 어느 쪽이 실제로 탈퇴시키는지 이름만으로 구분되지 않는다.
            */}
            <button
              className="button button--danger"
              type="button"
              disabled={!confirmed || isPending}
              onClick={() => {
                setError('')
                withdrawMutation.mutate()
              }}
            >
              {isPending ? '처리 중' : '탈퇴하기'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
