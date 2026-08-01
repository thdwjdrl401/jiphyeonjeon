import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import AuthShell from '@/features/auth/AuthShell'
import { authService } from '@/features/auth/authService'
import { isMockApiEnabled } from '@/shared/config/runtime'
import { usePageTitle } from '@/shared/lib/usePageTitle'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 비밀번호 재설정 요청 화면 — 로그인을 못 하는 사람의 주 진입점.
 *
 * <p><b>계정이 있는지 알려주지 않는다.</b> 이 제품은 이메일이 곧 로그인 식별자라
 * (CONTRACT.md — "인증 식별자는 email"), "그런 계정이 없습니다"를 보여 주면 임의의 이메일을
 * 넣어 가입자인지 확인하는 수단이 된다. 그래서 성공·실패를 가리지 않고 같은 안내를 낸다.
 *
 * <p>재설정은 임시 비밀번호가 아니라 <b>1회용 링크</b>다. 임시 비밀번호는 메일 본문에 계속 남아
 * 메일함이 뚫리면 그대로 쓸 수 있고, 사용자가 바꾸지 않으면 영구 비밀번호가 된다.
 */
export default function PasswordResetRequestPage() {
  usePageTitle('비밀번호 재설정')
  const [email, setEmail] = useState('')
  const [fieldError, setFieldError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSent, setIsSent] = useState(false)
  const [devResetLink, setDevResetLink] = useState('')

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const normalizedEmail = email.trim()
    if (!normalizedEmail) {
      setFieldError('이메일을 입력해 주세요.')
      return
    }
    if (!emailPattern.test(normalizedEmail)) {
      setFieldError('올바른 이메일 형식으로 입력해 주세요.')
      return
    }

    setFieldError('')
    setIsSubmitting(true)
    try {
      const ticket = await authService.requestPasswordReset(normalizedEmail)
      setIsSent(true)
      if (ticket.devResetToken) {
        setDevResetLink(publicPaths.passwordResetConfirm(ticket.devResetToken))
      }
    } catch (error) {
      // 서버가 아직 없거나 장애일 때만 여기로 온다. 계정 유무는 여기서도 드러나지 않는다.
      setFieldError(error instanceof Error ? error.message : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      variant="login"
      eyebrow="RESET PASSWORD"
      title="비밀번호를 잊으셨나요?"
      description="가입한 이메일로 재설정 링크를 보내 드립니다."
      footer={<p>비밀번호가 기억났나요? <Link to={publicPaths.login}>로그인으로 돌아가기</Link></p>}
    >
      {isSent ? (
        <div className="auth-result" role="status">
          <strong>재설정 링크를 보냈습니다.</strong>
          <p>
            입력한 이메일로 비밀번호 재설정 링크를 보냈습니다. 메일이 보이지 않으면 스팸함도 확인해 주세요.
            링크는 한 번만 사용할 수 있습니다.
          </p>
          {devResetLink && (
            <div className="demo-notice">
              <strong>개발용 미리보기</strong>
              <span>
                실제 메일 발송은 아직 준비 중입니다. 이 링크로 이어서 진행할 수 있어요 —{' '}
                <Link to={devResetLink}>재설정 화면으로 이동</Link>
              </span>
            </div>
          )}
        </div>
      ) : (
        <form className="auth-form" aria-label="비밀번호 재설정 요청" onSubmit={handleSubmit} noValidate>
          {isMockApiEnabled && (
            <div className="demo-notice">
              <strong>개발용 미리보기</strong>
              <span>메일 발송 서버가 없어, 요청 후 재설정 링크를 화면에 직접 보여 줍니다.</span>
            </div>
          )}

          <div className={`form-group${fieldError ? ' has-error' : ''}`}>
            <label htmlFor="reset-email">이메일</label>
            <div className="input-shell">
              <span className="input-icon" aria-hidden="true">@</span>
              <input
                id="reset-email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={320}
                value={email}
                placeholder="name@example.com"
                aria-invalid={Boolean(fieldError)}
                aria-describedby={fieldError ? 'reset-email-error' : undefined}
                onChange={(event) => {
                  setEmail(event.target.value)
                  if (fieldError) setFieldError('')
                }}
              />
            </div>
            {fieldError && <p className="field-error" id="reset-email-error">{fieldError}</p>}
          </div>

          <button className="button button--primary button--full button--large" type="submit" disabled={isSubmitting}>
            {isSubmitting ? <><span className="spinner spinner--light" aria-hidden="true" /> 보내는 중</> : <>재설정 링크 받기 <span aria-hidden="true">→</span></>}
          </button>
        </form>
      )}
    </AuthShell>
  )
}
