import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { profileService } from '@/features/profile/profileService'
import { useAuth } from '@/features/auth/AuthContext'
import AuthShell from '@/features/auth/AuthShell'
import { usePageTitle } from '@/shared/lib/usePageTitle'

const MIN_PASSWORD_LENGTH = 8

/**
 * 임시 비밀번호로 들어온 사람이 반드시 지나는 화면.
 *
 * <p><b>임시 비밀번호를 다시 묻지 않는다.</b> 방금 그 값으로 로그인해 세션이 섰다 — 이미 증명된
 * 것을 한 번 더 치게 하면 "방금 친 걸 왜 또 치지"에서 막힌다. 서버도 같은 이유로 이 경로에서만
 * 현재 비밀번호를 요구하지 않는다(`PUT /me/password/temporary`, 임시 로그인 세션에서만 열린다).
 *
 * <p><b>나가는 길을 두지 않는다.</b> 임시 비밀번호는 평문으로 메일함에 남아 있어서, "나중에 하기"를
 * 두면 대부분 그대로 쓴다. 로그아웃 외에는 이 화면을 벗어날 수 없다.
 */
export default function PasswordChangeRequiredPage() {
  usePageTitle('새 비밀번호 설정')
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isTooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH
  const isMismatched = confirmPassword.length > 0 && newPassword !== confirmPassword
  const canSubmit = newPassword.length >= MIN_PASSWORD_LENGTH
    && newPassword === confirmPassword
    && !isSubmitting

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitError('')
    setIsSubmitting(true)
    try {
      await profileService.replaceTemporaryPassword(newPassword)
      // 서버가 임시 비밀번호를 폐기하고 세션 표시도 지웠다. 다시 읽어야 게이트가 풀린다.
      await refreshUser()
      navigate('/', { replace: true })
    } catch (error) {
      setSubmitError(error instanceof Error && error.message
        ? error.message
        : '비밀번호를 바꾸지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      variant="login"
      eyebrow="NEW PASSWORD"
      title="새 비밀번호를 정해 주세요"
      description="임시 비밀번호로 로그인했습니다. 계속하려면 새 비밀번호가 필요합니다."
      footer={<p>새 비밀번호를 정하면 메일로 받은 임시 비밀번호는 곧바로 폐기됩니다.</p>}
    >
      <form className="auth-form" aria-label="새 비밀번호 설정" onSubmit={handleSubmit} noValidate>
        <div className={`form-group${isTooShort ? ' has-error' : ''}`}>
          <label htmlFor="new-password">새 비밀번호</label>
          <div className="input-shell">
            <span className="input-icon" aria-hidden="true">*</span>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              placeholder="8자 이상"
              aria-invalid={isTooShort}
              aria-describedby={isTooShort ? 'new-password-error' : undefined}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
          </div>
          {isTooShort && (
            <p className="field-error" id="new-password-error">
              비밀번호는 {MIN_PASSWORD_LENGTH}자 이상이어야 합니다.
            </p>
          )}
        </div>

        <div className={`form-group${isMismatched ? ' has-error' : ''}`}>
          <label htmlFor="confirm-password">새 비밀번호 확인</label>
          <div className="input-shell">
            <span className="input-icon" aria-hidden="true">*</span>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              placeholder="한 번 더 입력해 주세요"
              aria-invalid={isMismatched}
              aria-describedby={isMismatched ? 'confirm-password-error' : undefined}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>
          {isMismatched && (
            <p className="field-error" id="confirm-password-error">두 비밀번호가 서로 다릅니다.</p>
          )}
        </div>

        {submitError && <p className="field-error" role="alert">{submitError}</p>}

        <button className="button button--primary button--full button--large" type="submit" disabled={!canSubmit}>
          {isSubmitting
            ? <><span className="spinner spinner--light" aria-hidden="true" /> 바꾸는 중</>
            : <>새 비밀번호로 바꾸기 <span aria-hidden="true">→</span></>}
        </button>
      </form>
    </AuthShell>
  )
}
