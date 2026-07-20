import type { PropsWithChildren, ReactNode } from 'react'

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description: string; action?: ReactNode }) {
  return (
    <header className="workspace-page-header">
      <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1><p>{description}</p></div>
      {action && <div className="workspace-page-header__action">{action}</div>}
    </header>
  )
}

export function Panel({ title, description, action, children, className = '' }: PropsWithChildren<{ title?: string; description?: string; action?: ReactNode; className?: string }>) {
  return (
    <section className={`workspace-panel ${className}`.trim()}>
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
