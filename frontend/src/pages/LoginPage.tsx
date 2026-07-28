import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import AuthShell from '@/features/auth/AuthShell'
import { useAuth } from '@/features/auth/AuthContext'
import { ApiError } from '@/shared/api/client'
import { isMockApiEnabled } from '@/shared/config/runtime'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { useToast } from '@/shared/ui/Toast'

interface LoginLocationState {
  signupSuccess?: boolean
  displayName?: string
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function LoginPage() {
  usePageTitle('로그인')
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as LoginLocationState | null
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const toast = useToast()

  // 가입 완료 알림은 폼 위 배너가 아니라 토스트로 띄운다 — 한 번 읽고 사라지면 되는 알림이라
  // 로그인 폼 옆에 계속 남아 있을 이유가 없다. 띄운 뒤 history state를 지워
  // 새로고침·뒤로가기로 같은 알림이 되살아나지 않게 한다.
  const signupNoticeShown = useRef(false)
  useEffect(() => {
    if (!locationState?.signupSuccess || signupNoticeShown.current) return
    signupNoticeShown.current = true
    toast.success(`${locationState.displayName ? `${locationState.displayName}님, ` : ''}가입이 완료됐어요. 이제 로그인해 주세요.`)
    navigate(location.pathname, { replace: true, state: null })
  }, [locationState, toast, navigate, location.pathname])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextErrors: typeof errors = {}
    const normalizedEmail = email.trim()
    if (!normalizedEmail) nextErrors.email = '이메일을 입력해 주세요.'
    else if (!emailPattern.test(normalizedEmail)) nextErrors.email = '올바른 이메일 형식으로 입력해 주세요.'
    if (!password) nextErrors.password = '비밀번호를 입력해 주세요.'
    setErrors(nextErrors)
    setSubmitError('')
    if (Object.keys(nextErrors).length > 0) return

    setIsSubmitting(true)
    try {
      await login({ email: normalizedEmail, password })
      navigate(publicPaths.curriculums, { replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setSubmitError('로그인 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.')
      } else {
        setSubmitError('이메일 또는 비밀번호를 확인해 주세요.')
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
      footer={<p>아직 계정이 없나요? <Link to={publicPaths.signup}>무료로 시작하기</Link></p>}
    >
      {isMockApiEnabled && (
        <div className="demo-notice">
          <strong>개발용 미리보기</strong>
          <span>instructor@liveclass.ai로 로그인하면 강사 화면을 확인할 수 있습니다.</span>
        </div>
      )}

      <form className="auth-form" aria-label="로그인" onSubmit={handleSubmit} noValidate>
        <div className={`form-group${errors.email ? ' has-error' : ''}`}>
          <label htmlFor="email">이메일</label>
          <div className="input-shell">
            <span className="input-icon" aria-hidden="true">@</span>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              maxLength={320}
              value={email}
              placeholder="name@example.com"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'email-error' : undefined}
              onChange={(event) => {
                setEmail(event.target.value)
                if (errors.email) setErrors((current) => ({ ...current, email: undefined }))
              }}
            />
          </div>
          {errors.email && <p className="field-error" id="email-error">{errors.email}</p>}
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
