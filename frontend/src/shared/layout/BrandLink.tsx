import { Link } from 'react-router-dom'

interface BrandLinkProps {
  inverse?: boolean
}

export default function BrandLink({ inverse = false }: BrandLinkProps) {
  return (
    <Link className={`brand-link${inverse ? ' brand-link--inverse' : ''}`} to="/">
      <span className="brand-mark" aria-hidden="true">
        L
      </span>
      <span>
        LiveClass <strong>AI</strong>
      </span>
    </Link>
  )
}
