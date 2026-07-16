import { Outlet } from 'react-router-dom'
import GlobalFooter from './GlobalFooter'
import GlobalHeader from './GlobalHeader'

export default function PublicLayout() {
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main-content">
        본문으로 바로가기
      </a>
      <GlobalHeader />
      <main id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <GlobalFooter />
    </div>
  )
}
