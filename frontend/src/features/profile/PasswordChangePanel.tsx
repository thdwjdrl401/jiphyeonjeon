import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { publicPaths } from '@/app/router/paths'
import { useToast } from '@/shared/ui/Toast'
import { profileService } from './profileService'

const MIN_PASSWORD_LENGTH = 8

/**
 * 비밀번호 변경 폼.
 *
 * <p>확인 필드(`새 비밀번호 확인`)를 둔다. 서버는 새 비밀번호 하나만 받으므로
 * (`PUT /me/password` — currentPassword·newPassword) 이 필드는 전송하지 않고 화면에서만 대조한다.
 * 오타로 바꾼 비밀번호는 로그인 실패로만 드러나고 되돌릴 방법이 없어서, 입력 단계에서 잡는 것이
 * 유일한 방어다.
 *
 * <p>"비밀번호를 잊으셨나요?"는 여기서 보조 진입점이다. 주 진입점은 로그인 화면이다 — 이 기능이
 * 정말 필요한 사람은 로그인을 못 해서 이 화면에 오지도 못한다. 여기 두는 이유는 현재 비밀번호를
 * 기억하지 못해 위 폼을 채울 수 없는 경우다.
 */
export default function PasswordChangePanel() {
  const toast = useToast()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')

  const passwordMutation = useMutation({
    mutationFn: () => profileService.changePassword({ currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setError('')
      toast.success('비밀번호가 변경되었습니다.')
    },
    onError: (mutationError) => {
      setError(mutationError.message || '비밀번호를 변경하지 못했습니다.')
    },
  })

  const isTooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH
  const isMismatched = confirmPassword.length > 0 && newPassword !== confirmPassword
  const canSubmit = Boolean(currentPassword)
    && newPassword.length >= MIN_PASSWORD_LENGTH
    && newPassword === confirmPassword
    && !passwordMutation.isPending

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return
    setError('')
    passwordMutation.mutate()
  }

  return (
    <>
      <form className="workspace-form" aria-label="비밀번호 변경" onSubmit={submit}>
        <label>
          <span>현재 비밀번호</span>
          <input
            type="password"
            value={currentPassword}
            autoComplete="current-password"
            disabled={passwordMutation.isPending}
            onChange={(event) => setCurrentPassword(event.target.value)}
          />
        </label>
        <label>
          {/*
            도움말(`small`)이 label 안에 있어 감싸는 label을 그대로 쓰면 접근성 이름이
            "새 비밀번호 8자 이상으로…"가 된다. 이름은 라벨 텍스트로 고정하고 도움말은
            aria-describedby로만 연결한다 — 스크린리더가 필드 이름과 설명을 따로 읽는다.
          */}
          <span id="new-password-label">새 비밀번호</span>
          <input
            type="password"
            value={newPassword}
            minLength={MIN_PASSWORD_LENGTH}
            autoComplete="new-password"
            aria-labelledby="new-password-label"
            aria-describedby="new-password-help"
            aria-invalid={isTooShort}
            disabled={passwordMutation.isPending}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <small id="new-password-help">8자 이상으로 입력해 주세요.</small>
        </label>
        <label>
          <span>새 비밀번호 확인</span>
          <input
            type="password"
            value={confirmPassword}
            autoComplete="new-password"
            aria-invalid={isMismatched}
            aria-describedby={isMismatched ? 'confirm-password-error' : undefined}
            disabled={passwordMutation.isPending}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>

        {isMismatched && (
          <p className="field-error" id="confirm-password-error">새 비밀번호가 서로 다릅니다.</p>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}

        <div className="form-actions">
          <button className="button button--primary" type="submit" disabled={!canSubmit}>
            {passwordMutation.isPending ? '변경 중' : '비밀번호 변경'}
          </button>
        </div>
      </form>

      <p className="settings-aside">
        현재 비밀번호가 기억나지 않나요?{' '}
        <Link to={publicPaths.passwordResetRequest}>비밀번호를 잊으셨나요?</Link>
      </p>
    </>
  )
}
