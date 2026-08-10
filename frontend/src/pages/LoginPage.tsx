import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import AuthShell from '@/features/auth/AuthShell'
import { useAuth } from '@/features/auth/AuthContext'
import { profileService } from '@/features/profile/profileService'
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
  const { login, refreshUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as LoginLocationState | null
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({})
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  /** 원래 비밀번호로 들어왔는데 임시 비밀번호가 살아 있을 때만 뜬다. */
  const [discardPrompt, setDiscardPrompt] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)
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
      const signedIn = await login({ email: normalizedEmail, password })
      /*
       * 원래 비밀번호로 들어왔는데 임시 비밀번호가 걸려 있다. 재발급은 남이 눌렀을 수도 있으므로
       * 여기서 폐기할 기회를 준다 — 이 자리를 지나치면 그 값은 만료까지 계속 통한다.
       *
       * 임시 비밀번호로 들어온 사람에게는 묻지 않는다. 그 사람은 곧바로 변경 화면으로 가고,
       * 새 비밀번호를 정하는 순간 임시 값은 어차피 폐기된다.
       */
      if (signedIn.temporaryPasswordActive && !signedIn.signedInWithTemporaryPassword) {
        setDiscardPrompt(true)
        return
      }
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

  const finishLogin = () => navigate(publicPaths.curriculums, { replace: true })

  const discardTemporaryPassword = async () => {
    setIsDiscarding(true)
    try {
      await profileService.discardTemporaryPassword()
      await refreshUser()
      toast.success('임시 비밀번호를 폐기했습니다.')
    } catch {
      // 폐기에 실패해도 로그인은 이미 됐다 — 여기서 붙잡아 두면 들어가지도 못한다.
      toast.error('임시 비밀번호를 폐기하지 못했습니다. 계정 설정에서 다시 시도해 주세요.')
    } finally {
      setIsDiscarding(false)
      finishLogin()
    }
  }

  if (discardPrompt) {
    return (
      <AuthShell
        variant="login"
        eyebrow="TEMPORARY PASSWORD"
        title="임시 비밀번호가 발급되어 있어요"
        description="메일로 보낸 임시 비밀번호가 아직 살아 있습니다. 지금 폐기할까요?"
        footer={<p>요청한 적이 없다면 폐기하시는 편이 안전합니다.</p>}
      >
        <div className="auth-result" role="status">
          <p>
            임시 비밀번호는 발급 후 30분 동안 이 계정에 쓸 수 있습니다. 본인이 요청한 것이 아니라면
            지금 폐기해 주세요. 폐기해도 방금 쓰신 비밀번호는 그대로 사용할 수 있습니다.
          </p>
        </div>
        <div className="auth-form">
          <button
            className="button button--primary button--full button--large"
            disabled={isDiscarding}
            type="button"
            onClick={() => void discardTemporaryPassword()}
          >
            {isDiscarding
              ? <><span className="spinner spinner--light" aria-hidden="true" /> 폐기하는 중</>
              : '임시 비밀번호 폐기하기'}
          </button>
          <button
            className="button button--ghost button--full"
            disabled={isDiscarding}
            type="button"
            onClick={finishLogin}
          >
            그대로 두기
          </button>
        </div>
      </AuthShell>
    )
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
            {/* 재설정의 주 진입점 — 로그인을 못 하는 사람이 실제로 서 있는 화면이 여기다. */}
            <Link className="label-row__link" to={publicPaths.passwordResetRequest}>비밀번호를 잊으셨나요?</Link>
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
