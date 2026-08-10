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
 * <p><b>나가는 길을 두지 않는다.</b> 임시 비밀번호는 평문으로 메일함에 남아 있어서, 그 메일이 사는
 * 동안 계정도 열려 있는 셈이다. "나중에 하기"를 두면 대부분 그대로 쓴다 — 그래서 로그아웃 외에는
 * 이 화면을 벗어날 수 없다.
 *
 * <p>계정 설정의 비밀번호 변경과 같은 API를 쓴다(현재 비밀번호 = 메일로 받은 임시 비밀번호).
 * 서버는 변경에 성공하면 표시를 내리고, 그때 라우트 가드가 이 화면을 놓아 준다.
 */
export default function PasswordChangeRequiredPage() {
  usePageTitle('새 비밀번호 설정')
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  const [temporaryPassword, setTemporaryPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const isTooShort = newPassword.length > 0 && newPassword.length < MIN_PASSWORD_LENGTH
  const isMismatched = confirmPassword.length > 0 && newPassword !== confirmPassword
  /*
   * 임시 비밀번호를 그대로 새 비밀번호로 쓰는 것을 막는다. 서버가 거절하지는 않지만, 그러면
   * 메일에 남은 값이 그대로 영구 비밀번호가 되어 이 화면을 만든 이유가 사라진다.
   */
  const isSameAsTemporary = newPassword.length > 0 && newPassword === temporaryPassword
  const canSubmit = temporaryPassword.length > 0
    && newPassword.length >= MIN_PASSWORD_LENGTH
    && newPassword === confirmPassword
    && !isSameAsTemporary
    && !isSubmitting

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitError('')
    setIsSubmitting(true)
    try {
      await profileService.changePassword({ currentPassword: temporaryPassword, newPassword })
      // 서버가 표시를 내렸다. 새로 읽어야 가드가 이 화면을 놓아 준다.
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
      footer={<p>이 화면은 비밀번호를 바꾸기 전까지 계속 나타납니다.</p>}
    >
      <form className="auth-form" aria-label="새 비밀번호 설정" onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label htmlFor="temporary-password">메일로 받은 임시 비밀번호</label>
          <input
            id="temporary-password"
            type="password"
            autoComplete="current-password"
            value={temporaryPassword}
            onChange={(event) => setTemporaryPassword(event.target.value)}
          />
        </div>

        <div className={`form-group${isTooShort || isSameAsTemporary ? ' has-error' : ''}`}>
          <label htmlFor="new-password">새 비밀번호</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          {isTooShort && <p role="alert">비밀번호는 {MIN_PASSWORD_LENGTH}자 이상이어야 합니다.</p>}
          {isSameAsTemporary && <p role="alert">임시 비밀번호와 다른 값으로 정해 주세요.</p>}
        </div>

        <div className={`form-group${isMismatched ? ' has-error' : ''}`}>
          <label htmlFor="confirm-password">새 비밀번호 확인</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
          {isMismatched && <p role="alert">두 비밀번호가 서로 다릅니다.</p>}
        </div>

        {submitError && <p className="auth-form__error" role="alert">{submitError}</p>}

        <button className="button button--primary button--full button--large" type="submit" disabled={!canSubmit}>
          {isSubmitting ? <><span className="spinner spinner--light" aria-hidden="true" /> 바꾸는 중</> : '새 비밀번호로 바꾸기'}
        </button>
      </form>
    </AuthShell>
  )
}
