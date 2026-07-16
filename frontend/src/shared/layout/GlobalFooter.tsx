import { Link } from 'react-router-dom'
import BrandLink from './BrandLink'

export default function GlobalFooter() {
  return (
    <footer className="global-footer">
      <div className="page-container footer-grid">
        <div className="footer-brand">
          <BrandLink inverse />
          <p>라이브의 몰입과 다시보기의 깊이를 하나의 학습 경험으로 연결합니다.</p>
        </div>
        <nav className="footer-navigation" aria-label="하단 메뉴">
          <div>
            <strong>서비스</strong>
            <Link to="/curriculums">커리큘럼 탐색</Link>
            <Link to="/signup">강사로 시작하기</Link>
          </div>
          <div>
            <strong>LiveClass AI</strong>
            <span>실시간 자막</span>
            <span>근거 기반 AI</span>
          </div>
        </nav>
      </div>
      <div className="page-container footer-bottom">
        <small>© 2026 LiveClass AI. All rights reserved.</small>
        <small>함께 배우는 순간을 더 선명하게.</small>
      </div>
    </footer>
  )
}
