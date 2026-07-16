import { Link } from 'react-router-dom'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import BrandLink from '@/shared/layout/BrandLink'

export default function NotFoundPage() {
  usePageTitle('페이지를 찾을 수 없음')

  return (
    <div className="system-page">
      <header><BrandLink /></header>
      <main>
        <div className="system-code" aria-hidden="true">404</div>
        <span className="eyebrow">PAGE NOT FOUND</span>
        <h1>요청한 페이지를 찾을 수 없어요</h1>
        <p>주소가 잘못되었거나 아직 준비 중인 페이지일 수 있습니다.<br />안전한 경로에서 다시 시작해 주세요.</p>
        <div className="system-actions">
          <Link className="button button--primary button--large" to="/">웰컴으로 이동</Link>
          <Link className="button button--soft button--large" to="/curriculums">커리큘럼 탐색</Link>
        </div>
      </main>
    </div>
  )
}
