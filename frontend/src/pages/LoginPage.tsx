import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import AuthShell from '@/features/auth/AuthShell'
import { useAuth } from '@/features/auth/AuthContext'
import { ApiError } from '@/shared/api/client'
import { isMockApiEnabled } from '@/shared/config/runtime'
import { usePageTitle } from '@/shared/lib/usePageTitle'

interface LoginLocationState {
  signupSuccess?: boolean
  displayName?: string
}

function getSafeReturnTo(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null
  try {
    const target = new URL(value, window.location.origin)
    if (target.origin !== window.location.origin) return null
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return null
  }
}

export default function LoginPage() {
  usePageTitle('로그인')
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const returnTo = getSafeReturnTo(searchParams.get('returnTo'))
  const locationState = location.state as LoginLocationState | null
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<{ loginId?: string; password?: string }>({})
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const signupHref = returnTo
    ? `/signup?returnTo=${encodeURIComponent(returnTo)}`
    : '/signup'

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextErrors: typeof errors = {}
    if (!loginId.trim()) nextErrors.loginId = '아이디를 입력해 주세요.'
    if (!password) nextErrors.password = '비밀번호를 입력해 주세요.'
    setErrors(nextErrors)
    setSubmitError('')
    if (Object.keys(nextErrors).length > 0) return

    setIsSubmitting(true)
    try {
      await login({ loginId: loginId.trim(), password })
      navigate(returnTo ?? '/', { replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setSubmitError('로그인 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.')
      } else {
        setSubmitError('아이디 또는 비밀번호를 확인해 주세요.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      variant="login"
      eyebrow="WELCOME BACK"
      title="다시 만나서 반가워요"
      description="로그인하고 멈췄던 배움을 이어가세요."
      footer={<p>아직 계정이 없나요? <Link to={signupHref}>무료로 시작하기</Link></p>}
    >
      {locationState?.signupSuccess && (
        <div className="form-notice form-notice--success" role="status">
          <span aria-hidden="true">✓</span>
          {locationState.displayName ? `${locationState.displayName}님, ` : ''}가입이 완료됐어요. 이제 로그인해 주세요.
        </div>
      )}
      {returnTo && (
        <div className="form-notice" role="status">
          로그인 후 요청한 페이지로 안전하게 돌아갑니다.
        </div>
      )}
      {isMockApiEnabled && (
        <div className="demo-notice">
          <strong>개발용 미리보기</strong>
          <span>아이디에 instructor를 포함하면 강사 화면으로 로그인됩니다.</span>
        </div>
      )}

      <form className="auth-form" aria-label="로그인" onSubmit={handleSubmit} noValidate>
        <div className={`form-group${errors.loginId ? ' has-error' : ''}`}>
          <label htmlFor="loginId">아이디</label>
          <div className="input-shell">
            <span className="input-icon" aria-hidden="true">@</span>
            <input
              id="loginId"
              name="loginId"
              autoComplete="username"
              value={loginId}
              placeholder="아이디를 입력하세요"
              aria-invalid={Boolean(errors.loginId)}
              aria-describedby={errors.loginId ? 'loginId-error' : undefined}
              onChange={(event) => {
                setLoginId(event.target.value)
                if (errors.loginId) setErrors((current) => ({ ...current, loginId: undefined }))
              }}
            />
          </div>
          {errors.loginId && <p className="field-error" id="loginId-error">{errors.loginId}</p>}
        </div>

        <div className={`form-group${errors.password ? ' has-error' : ''}`}>
          <div className="label-row">
            <label htmlFor="password">비밀번호</label>
          </div>
          <div className="input-shell">
            <span className="input-icon" aria-hidden="true">●</span>
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              placeholder="비밀번호를 입력하세요"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? 'password-error' : undefined}
              onChange={(event) => {
                setPassword(event.target.value)
                if (errors.password) setErrors((current) => ({ ...current, password: undefined }))
              }}
            />
            <button className="input-action" type="button" aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} onClick={() => setShowPassword((current) => !current)}>
              {showPassword ? '숨김' : '보기'}
            </button>
          </div>
          {errors.password && <p className="field-error" id="password-error">{errors.password}</p>}
        </div>

        {submitError && <div className="form-error" role="alert"><span aria-hidden="true">!</span>{submitError}</div>}

        <button className="button button--primary button--full button--large" type="submit" disabled={isSubmitting}>
          {isSubmitting ? <><span className="spinner spinner--light" aria-hidden="true" /> 로그인 중</> : <>로그인 <span aria-hidden="true">→</span></>}
        </button>
      </form>
    </AuthShell>
  )
}
