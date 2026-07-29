import { Link } from 'react-router-dom'

interface BrandLinkProps {
  inverse?: boolean
}

export default function BrandLink({ inverse = false }: BrandLinkProps) {
  return (
    <Link className={`brand-link${inverse ? ' brand-link--inverse' : ''}`} to="/">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 40 40" role="img">
          <path d="M5 25.5C10.5 16 18 12 28.5 10.5C22 15 17 20 14 28" />
          <path d="M8 30.5C15.5 27 23 25.5 33 27" />
          <rect x="27" y="29" width="7" height="7" rx="1" />
        </svg>
      </span>
      <span className="brand-name"><strong>집현전</strong><small>LIVECLASS AI</small></span>
    </Link>
  )
}
