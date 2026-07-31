import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { publicPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import type { UserRole } from '@/features/auth/types'
import { ApiError } from '@/shared/api/client'
import { InlineNotice } from '@/shared/ui/WorkspaceUi'
import { profileService } from './profileService'

interface AccountWithdrawPanelProps {
  role: UserRole
}

/**
 * 회원 탈퇴 패널 — 안내 → 동의 → 실행.
 *
 * <p><b>안내 문구는 실제 서버 동작에 맞춘 것이다</b>(ADR-0031). 탈퇴는 하드 삭제가 아니라
 * 소프트 삭제다: `status`가 `WITHDRAWN`으로 바뀌어 로그인만 막히고, 커리큘럼·수강 기록은 남는다
 * (`curriculum.instructor_id`·`enrollment.user_id`가 CASCADE 없는 FK라 지울 수도 없고,
 * 이미 수강한 수강생을 위해 남아야 한다). 탈퇴 시 이메일을 tombstone 처리하므로 **같은 이메일로
 * 재가입이 허용된다**.
 *
 * <p>그래서 "모든 데이터가 즉시 삭제되며 복구할 수 없습니다" 류의 흔한 문구를 쓸 수 없다 —
 * 사실이 아니고, 개인정보 파기에 관한 거짓 고지가 된다.
 *
 * <p>진행 중 라이브 차단은 <b>서버가 권위</b>다(`LiveWithdrawalGuard` → 409
 * `AUTH_WITHDRAWAL_BLOCKED`). FE가 미리 판정하지 않는 이유: 프로필 화면에서 "이 강사에게 켜져 있는
 * 라이브가 있는가"를 한 번에 묻는 API가 없어서 커리큘럼을 전부 훑어야 하고, 훑는 사이 상태가
 * 바뀌면 화면과 서버가 어긋난다. 대신 ① 강사에게는 조건을 미리 안내하고 ② 409를 폼 안에
 * 그대로 띄운다 — 토스트로만 흘리면 왜 실패했는지가 사라진다.
 */
export default function AccountWithdrawPanel({ role }: AccountWithdrawPanelProps) {
  const navigate = useNavigate()
  const { logout } = useAuth()
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

  return (
    <div className="withdraw-panel">
      <p className="withdraw-panel__lead">
        회원 탈퇴 시 계정이 비활성화되어 더 이상 로그인할 수 없습니다.
      </p>

      <ul className="withdraw-panel__notice">
        <li>강의, 커리큘럼 및 학습 기록은 서비스 운영을 위해 보존됩니다.</li>
        <li>동일한 이메일로 언제든지 다시 회원가입할 수 있습니다.</li>
        {role === 'INSTRUCTOR' && (
          <li>진행 중인 라이브 강의가 있으면 탈퇴할 수 없습니다. 먼저 강의를 종료해 주세요.</li>
        )}
      </ul>

      <p className="withdraw-panel__question">탈퇴를 진행하시겠습니까?</p>

      <label className="choice-row">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={withdrawMutation.isPending}
          onChange={(event) => {
            setConfirmed(event.target.checked)
            if (event.target.checked) setError('')
          }}
        />
        <span>위 안내 사항을 모두 확인하였으며, 이에 동의합니다.</span>
      </label>

      {error && <InlineNotice tone="danger">{error}</InlineNotice>}

      <div className="form-actions">
        <button
          className="button button--danger"
          type="button"
          disabled={!confirmed || withdrawMutation.isPending}
          onClick={() => {
            setError('')
            withdrawMutation.mutate()
          }}
        >
          {withdrawMutation.isPending ? '처리 중' : '회원 탈퇴'}
        </button>
      </div>
    </div>
  )
}
