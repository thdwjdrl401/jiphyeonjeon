import type { ReactNode } from 'react'

interface PageStateProps {
  title: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  compact?: boolean
}

export default function PageState({
  title,
  description,
  icon,
  action,
  compact = false,
}: PageStateProps) {
  return (
    <div className={`page-state${compact ? ' page-state--compact' : ''}`}>
      {icon && <div className="page-state__icon" aria-hidden="true">{icon}</div>}
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  )
}
