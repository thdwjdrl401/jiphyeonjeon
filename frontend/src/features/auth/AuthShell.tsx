import type { PropsWithChildren, ReactNode } from 'react'
import authRoyalLibraryEvening from '@/assets/images/auth-royal-library-evening.webp'
import BrandLink from '@/shared/layout/BrandLink'

interface AuthShellProps extends PropsWithChildren {
  eyebrow: string
  title: string
  description: string
  footer: ReactNode
  variant: 'login' | 'signup'
}

export default function AuthShell({
  eyebrow,
  title,
  description,
  footer,
  variant,
  children,
}: AuthShellProps) {
  return (
    <div className="auth-page">
      <div className="auth-shell">
        <aside className={`auth-visual auth-visual--${variant}`}>
          <img
            className="auth-visual__art"
            src={authRoyalLibraryEvening}
            alt=""
            aria-hidden="true"
            decoding="async"
          />
          <BrandLink inverse />
          <div className="auth-visual__copy">
            <span className="live-pill"><i /> Live learning, better remembered</span>
            <h2>수업의 모든 순간이<br />나만의 학습 자산이 되도록</h2>
            <p>실시간 자막과 근거 기반 AI가 이해하지 못한 순간을 다시 연결해 드려요.</p>
          </div>
          <div className="auth-caption-card" aria-hidden="true">
            <span className="auth-speaker">AI</span>
            <div>
              <small>방금 설명한 개념을 찾았어요</small>
              <strong>트랜잭션의 원자성을 예시와 함께 정리했어요.</strong>
            </div>
          </div>
          <span className="auth-orb auth-orb--one" />
          <span className="auth-orb auth-orb--two" />
        </aside>

        <section className="auth-content" aria-labelledby="auth-title">
          <div className="auth-content__inner">
            <div className="auth-intro">
              <span className="eyebrow">{eyebrow}</span>
              <h1 id="auth-title">{title}</h1>
              <p>{description}</p>
            </div>
            {children}
            <div className="auth-footer">{footer}</div>
          </div>
        </section>
      </div>
    </div>
  )
}
