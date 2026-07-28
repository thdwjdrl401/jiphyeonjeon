import { Link } from 'react-router-dom'
import brandMarkHanok from '@/assets/images/brand-mark-hanok.png'

interface BrandLinkProps {
  inverse?: boolean
}

export default function BrandLink({ inverse = false }: BrandLinkProps) {
  return (
    <Link className={`brand-link${inverse ? ' brand-link--inverse' : ''}`} to="/">
      <span className="brand-mark" aria-hidden="true">
        <img className="brand-mark__img" src={brandMarkHanok} alt="" />
      </span>
      <span>집현전</span>
    </Link>
  )
}
