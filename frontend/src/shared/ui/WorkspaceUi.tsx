import type { PropsWithChildren, ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <header className="workspace-page-header">
      <div><h1>{title}</h1>{description && <p>{description}</p>}</div>
      {action && <div className="workspace-page-header__action">{action}</div>}
    </header>
  )
}

/** `id`는 화면 안의 특정 영역으로 데려가는 링크(#anchor)를 위한 것이다 — 알림이 그 링크를 쓴다. */
export function Panel({ id, title, description, action, children, className = '' }: PropsWithChildren<{ id?: string; title?: string; description?: string; action?: ReactNode; className?: string }>) {
  return (
    <section className={`workspace-panel ${className}`.trim()} id={id}>
      {(title || action) && <header className="workspace-panel__header"><div>{title && <h2>{title}</h2>}{description && <p>{description}</p>}</div>{action}</header>}
      {children}
    </section>
  )
}

/**
 * 상태 알약.
 *
 * <p>`to`를 주면 <b>링크로</b> 그린다 — `span`에 onClick만 붙이면 키보드로 못 누르고 스크린리더가
 * 누를 수 있는 것인 줄 모른다. `busy`는 배지 안에서 원을 돌린다(서버 상태가 아직 움직이는 중).
 */
export function StatusBadge({ children, tone = 'neutral', title, to, busy }: PropsWithChildren<{
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'live'
  title?: string
  to?: string
  busy?: boolean
}>) {
  const className = `status-pill status-pill--${tone}${to ? ' status-pill--link' : ''}`
  const content = (
    <>
      {busy && <i className="status-pill__spinner" aria-hidden="true" />}
      {children}
    </>
  )
  return to
    ? <Link className={className} to={to} title={title}>{content}</Link>
    : <span className={className} title={title}>{content}</span>
}

export function MetricCard({ label, value, helper }: { label: string; value: string | number; helper?: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong>{helper && <small>{helper}</small>}</article>
}

export function InlineNotice({ children, tone = 'info' }: PropsWithChildren<{ tone?: 'info' | 'success' | 'warning' | 'danger' }>) {
  return <div className={`inline-notice inline-notice--${tone}`} role="status">{children}</div>
}
