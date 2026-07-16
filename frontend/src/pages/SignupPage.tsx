import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AuthShell from '@/features/auth/AuthShell'
import { useAuth } from '@/features/auth/AuthContext'
import type { UserRole } from '@/features/auth/types'
import { ApiError } from '@/shared/api/client'
import { usePageTitle } from '@/shared/lib/usePageTitle'

type SignupField = 'role' | 'displayName' | 'loginId' | 'password' | 'passwordConfirm'
type SignupErrors = Partial<Record<SignupField, string>>
type Availability = 'idle' | 'checking' | 'available' | 'unavailable' | 'error'

const loginIdPattern = /^[a-zA-Z0-9._-]{4,20}$/

function validateLoginId(loginId: string) {
  if (!loginId) return '아이디를 입력해 주세요.'
  if (!loginIdPattern.test(loginId)) return '영문, 숫자, 마침표, 밑줄로 4–20자 입력해 주세요.'
  return undefined
}

export default function SignupPage() {
  usePageTitle('회원가입')
  const { signup, checkLoginId } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [role, setRole] = useState<UserRole | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [availability, setAvailability] = useState<Availability>('idle')
  const [errors, setErrors] = useState<SignupErrors>({})
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const returnTo = searchParams.get('returnTo')
  const loginHref = returnTo
    ? `/login?returnTo=${encodeURIComponent(returnTo)}`
    : '/login'

  const clearError = (field: SignupField) => {
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const handleAvailabilityCheck = async () => {
    const normalized = loginId.trim()
    const loginIdError = validateLoginId(normalized)
    if (loginIdError) {
      setErrors((current) => ({ ...current, loginId: loginIdError }))
      return
    }

    setAvailability('checking')
    setErrors((current) => ({ ...current, loginId: undefined }))
    try {
      const result = await checkLoginId(normalized)
      setAvailability(result.available ? 'available' : 'unavailable')
      if (!result.available) {
        setErrors((current) => ({ ...current, loginId: '이미 사용 중인 아이디입니다.' }))
      }
    } catch (error) {
      setAvailability('error')
      if (error instanceof ApiError && error.status === 429) {
        setErrors((current) => ({ ...current, loginId: '잠시 후 다시 확인해 주세요.' }))
      }
    }
  }

  const validate = () => {
    const nextErrors: SignupErrors = {}
    if (!role) nextErrors.role = '학생 또는 강사를 선택해 주세요.'
    const name = displayName.trim()
    if (!name) nextErrors.displayName = '이름을 입력해 주세요.'
    else if (name.length < 2 || name.length > 20) nextErrors.displayName = '이름은 2–20자로 입력해 주세요.'
    nextErrors.loginId = validateLoginId(loginId.trim())
    if (!nextErrors.loginId && availability !== 'available') nextErrors.loginId = '아이디 중복 확인을 완료해 주세요.'
    if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) nextErrors.password = '영문과 숫자를 포함해 8자 이상 입력해 주세요.'
    if (!passwordConfirm) nextErrors.passwordConfirm = '비밀번호를 한 번 더 입력해 주세요.'
    else if (password !== passwordConfirm) nextErrors.passwordConfirm = '비밀번호가 일치하지 않습니다.'
    return nextErrors
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const nextErrors = validate()
    setErrors(nextErrors)
    setSubmitError('')
    if (Object.values(nextErrors).some(Boolean) || !role) return

    setIsSubmitting(true)
    try {
      await signup({ loginId: loginId.trim(), password, displayName: displayName.trim(), role })
      navigate(loginHref, {
        replace: true,
        state: { signupSuccess: true, displayName: displayName.trim() },
      })
    } catch (error) {
      if (error instanceof ApiError && (error.status === 409 || error.code === 'AUTH_LOGIN_ID_DUPLICATED')) {
        setAvailability('unavailable')
        setErrors((current) => ({ ...current, loginId: '이미 사용 중인 아이디입니다.' }))
      } else if (error instanceof ApiError && error.status === 429) {
        setSubmitError('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.')
      } else {
        setSubmitError('가입을 완료하지 못했습니다. 입력 정보를 확인하고 다시 시도해 주세요.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AuthShell
      variant="signup"
      eyebrow="START YOUR JOURNEY"
      title="어떤 여정을 시작할까요?"
      description="역할을 선택하고 LiveClass AI와 함께 시작하세요."
      footer={<p>이미 계정이 있나요? <Link to={loginHref}>로그인하기</Link></p>}
    >
      <form className="auth-form signup-form" aria-label="회원가입" onSubmit={handleSubmit} noValidate>
        <fieldset className={`role-selector${errors.role ? ' has-error' : ''}`}>
          <legend>가입 유형 <span>*</span></legend>
          <div className="role-selector__grid">
            <button type="button" className={role === 'STUDENT' ? 'is-selected' : undefined} aria-pressed={role === 'STUDENT'} onClick={() => { setRole('STUDENT'); clearError('role') }}>
              <span className="role-icon role-icon--student" aria-hidden="true">✦</span>
              <span><strong>학생으로 배우기</strong><small>라이브로 질문하고 나만의 학습 기록을 만들어요.</small></span>
              <i aria-hidden="true">✓</i>
            </button>
            <button type="button" className={role === 'INSTRUCTOR' ? 'is-selected' : undefined} aria-pressed={role === 'INSTRUCTOR'} onClick={() => { setRole('INSTRUCTOR'); clearError('role') }}>
              <span className="role-icon role-icon--teacher" aria-hidden="true">◇</span>
              <span><strong>강사로 가르치기</strong><small>라이브 수업을 열고 AI로 학습 경험을 확장해요.</small></span>
              <i aria-hidden="true">✓</i>
            </button>
          </div>
          {errors.role && <p className="field-error">{errors.role}</p>}
        </fieldset>

        <div className={`form-group${errors.displayName ? ' has-error' : ''}`}>
          <label htmlFor="displayName">이름 <span>*</span></label>
          <div className="input-shell">
            <span className="input-icon" aria-hidden="true">○</span>
            <input id="displayName" autoComplete="name" value={displayName} placeholder="서비스에서 사용할 이름" aria-invalid={Boolean(errors.displayName)} onChange={(event) => { setDisplayName(event.target.value); clearError('displayName') }} />
          </div>
          {errors.displayName && <p className="field-error">{errors.displayName}</p>}
        </div>

        <div className={`form-group${errors.loginId ? ' has-error' : availability === 'available' ? ' has-success' : ''}`}>
          <label htmlFor="signup-loginId">아이디 <span>*</span></label>
          <div className="input-with-button">
            <div className="input-shell">
              <span className="input-icon" aria-hidden="true">@</span>
              <input id="signup-loginId" autoComplete="username" value={loginId} placeholder="4–20자 영문, 숫자" aria-invalid={Boolean(errors.loginId)} onChange={(event) => { setLoginId(event.target.value); setAvailability('idle'); clearError('loginId') }} />
            </div>
            <button className="button button--soft input-check-button" type="button" disabled={availability === 'checking'} onClick={handleAvailabilityCheck}>
              {availability === 'checking' ? '확인 중' : '중복 확인'}
            </button>
          </div>
          {availability === 'available' && <p className="field-success">사용할 수 있는 아이디입니다.</p>}
          {errors.loginId && <p className="field-error">{errors.loginId}</p>}
        </div>

        <div className="form-row">
          <div className={`form-group${errors.password ? ' has-error' : ''}`}>
            <label htmlFor="signup-password">비밀번호 <span>*</span></label>
            <div className="input-shell">
              <span className="input-icon" aria-hidden="true">●</span>
              <input id="signup-password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} placeholder="영문+숫자 8자 이상" aria-invalid={Boolean(errors.password)} onChange={(event) => { setPassword(event.target.value); clearError('password') }} />
              <button className="input-action" type="button" onClick={() => setShowPassword((current) => !current)}>{showPassword ? '숨김' : '보기'}</button>
            </div>
            {errors.password && <p className="field-error">{errors.password}</p>}
          </div>
          <div className={`form-group${errors.passwordConfirm ? ' has-error' : ''}`}>
            <label htmlFor="passwordConfirm">비밀번호 확인 <span>*</span></label>
            <div className="input-shell">
              <span className="input-icon" aria-hidden="true">●</span>
              <input id="passwordConfirm" type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={passwordConfirm} placeholder="한 번 더 입력" aria-invalid={Boolean(errors.passwordConfirm)} onChange={(event) => { setPasswordConfirm(event.target.value); clearError('passwordConfirm') }} />
            </div>
            {errors.passwordConfirm && <p className="field-error">{errors.passwordConfirm}</p>}
          </div>
        </div>

        {submitError && <div className="form-error" role="alert"><span aria-hidden="true">!</span>{submitError}</div>}

        <button className="button button--primary button--full button--large" type="submit" disabled={isSubmitting}>
          {isSubmitting ? <><span className="spinner spinner--light" aria-hidden="true" /> 가입하는 중</> : <>가입하고 시작하기 <span aria-hidden="true">→</span></>}
        </button>
      </form>
    </AuthShell>
  )
}
