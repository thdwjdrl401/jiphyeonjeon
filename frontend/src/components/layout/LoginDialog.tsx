import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '@/contexts/AuthContext'

interface LoginDialogProps {
  open: boolean
  onClose: () => void
}

interface LoginErrors {
  id?: string
  password?: string
  submit?: string
}

export function LoginDialog({ open, onClose }: LoginDialogProps) {
  const { login } = useAuth()
  const [id, setId] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<LoginErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setErrors({})
    }
  }, [open])

  if (!open) {
    return null
  }

  const close = () => {
    setId('')
    setPassword('')
    setErrors({})
    onClose()
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validationErrors: LoginErrors = {}
    if (!id) validationErrors.id = 'Please input ID'
    if (!password) validationErrors.password = 'Please input password'

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setErrors({})
    setIsSubmitting(true)
    try {
      await login({ id, password })
      close()
    } catch {
      setErrors({ submit: '로그인에 실패했습니다.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="login-dialog-overlay" role="presentation">
      <section className="login-dialog" role="dialog" aria-modal="true" aria-labelledby="login-title">
        <div className="login-dialog-header">
          <h2 id="login-title">로그인</h2>
          <button className="close-button" type="button" aria-label="로그인 닫기" onClick={close}>×</button>
        </div>
        <form onSubmit={submit} noValidate>
          <div className="form-group">
            <label htmlFor="login-id">아이디</label>
            <input id="login-id" value={id} onChange={(event) => setId(event.target.value)} autoComplete="username" />
            {errors.id && <span className="error-message">{errors.id}</span>}
          </div>
          <div className="form-group">
            <label htmlFor="login-password">비밀번호</label>
            <input
              id="login-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
            {errors.password && <span className="error-message">{errors.password}</span>}
          </div>
          {errors.submit && <p className="error-message submit-error" role="alert">{errors.submit}</p>}
          <div className="dialog-footer">
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? '로그인 중...' : '로그인'}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
