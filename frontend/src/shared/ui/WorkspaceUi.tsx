import type { PropsWithChildren, ReactNode } from 'react'

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

export function StatusBadge({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'live' }>) {
  return <span className={`status-pill status-pill--${tone}`}>{children}</span>
}

export function MetricCard({ label, value, helper }: { label: string; value: string | number; helper?: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong>{helper && <small>{helper}</small>}</article>
}

export function InlineNotice({ children, tone = 'info' }: PropsWithChildren<{ tone?: 'info' | 'success' | 'warning' | 'danger' }>) {
  return <div className={`inline-notice inline-notice--${tone}`} role="status">{children}</div>
}
