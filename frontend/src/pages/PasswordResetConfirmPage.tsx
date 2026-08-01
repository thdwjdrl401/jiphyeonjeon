import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import AuthShell from '@/features/auth/AuthShell'
import { authService } from '@/features/auth/authService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { useToast } from '@/shared/ui/Toast'

const MIN_PASSWORD_LENGTH = 8

/**
 * 재설정 링크를 타고 들어오는 화면. 토큰은 쿼리스트링(`?token=`)으로 받는다.
 *
 * <p>토큰이 없으면 폼을 아예 내지 않는다 — 채워 넣게 한 뒤 제출 시점에 실패시키면 사용자가
 * 자기 비밀번호를 의심한다.
 *
 * <p>성공 뒤 자동 로그인하지 않고 로그인 화면으로 보낸다. 새 비밀번호를 한 번 직접 입력해 보는
 * 것이 기억에 남고, 링크를 가진 사람이 곧 계정 주인이라는 보장도 없다.
 */
export default function PasswordResetConfirmPage() {
  usePageTitle('새 비밀번호 설정')
  const navigate = useNavigate()
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') ?? ''
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
      await authService.confirmPasswordReset({ token, newPassword })
      toast.success('비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요.')
      navigate(publicPaths.login, { replace: true })
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : '비밀번호를 변경하지 못했습니다.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      variant="login"
      eyebrow="RESET PASSWORD"
      title="새 비밀번호를 설정해 주세요"
      description="8자 이상으로 입력하면 바로 적용됩니다."
      footer={<p>도움이 필요하나요? <Link to={publicPaths.login}>로그인으로 돌아가기</Link></p>}
    >
      {!token ? (
        <div className="auth-result" role="alert">
          <strong>재설정 링크가 올바르지 않습니다.</strong>
          <p>
            메일에 담긴 링크를 그대로 열어 주세요. 링크가 만료되었다면{' '}
            <Link to={publicPaths.passwordResetRequest}>다시 요청</Link>할 수 있습니다.
          </p>
        </div>
      ) : (
        <form className="auth-form" aria-label="새 비밀번호 설정" onSubmit={handleSubmit} noValidate>
          <div className={`form-group${isTooShort ? ' has-error' : ''}`}>
            <label htmlFor="reset-new-password">새 비밀번호</label>
            <div className="input-shell">
              <span className="input-icon" aria-hidden="true">●</span>
              <input
                id="reset-new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={MIN_PASSWORD_LENGTH}
                value={newPassword}
                placeholder="8자 이상"
                aria-invalid={isTooShort}
                aria-describedby={isTooShort ? 'reset-new-password-error' : undefined}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>
            {isTooShort && <p className="field-error" id="reset-new-password-error">새 비밀번호는 8자 이상이어야 합니다.</p>}
          </div>

          <div className={`form-group${isMismatched ? ' has-error' : ''}`}>
            <label htmlFor="reset-confirm-password">새 비밀번호 확인</label>
            <div className="input-shell">
              <span className="input-icon" aria-hidden="true">●</span>
              <input
                id="reset-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                placeholder="같은 비밀번호를 다시 입력하세요"
                aria-invalid={isMismatched}
                aria-describedby={isMismatched ? 'reset-confirm-password-error' : undefined}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
            {isMismatched && <p className="field-error" id="reset-confirm-password-error">새 비밀번호가 서로 다릅니다.</p>}
          </div>

          {submitError && <div className="form-error" role="alert"><span aria-hidden="true">!</span>{submitError}</div>}

          <button className="button button--primary button--full button--large" type="submit" disabled={!canSubmit}>
            {isSubmitting ? <><span className="spinner spinner--light" aria-hidden="true" /> 변경 중</> : <>비밀번호 변경 <span aria-hidden="true">→</span></>}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
