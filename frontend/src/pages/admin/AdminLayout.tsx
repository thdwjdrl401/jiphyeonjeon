import { NavLink, Outlet } from 'react-router-dom'
import { adminPaths } from '@/app/router/paths'
import GlobalHeader from '@/shared/layout/GlobalHeader'
import '@/styles/admin.css'

/**
 * 운영 콘솔 껍데기. 제품 화면(WorkspaceLayout)과 나누는 이유는 사이드바에 들어갈 것이 다르기 때문이다 —
 * 여기 필요한 건 커리큘럼 목차가 아니라 <b>운영 대상 목록</b>이다.
 *
 * <p>헤더는 그대로 재사용한다. 운영자도 같은 계정으로 제품 화면을 오가므로, 헤더까지 갈라 놓으면
 * 돌아갈 길이 사라진다.
 */
export default function AdminLayout() {
  return (
    <>
      <GlobalHeader />
      <main className="page-container workspace-page">
        <div className="admin-shell">
          <nav className="admin-nav" aria-label="운영 콘솔">
            <span className="admin-nav__title">운영</span>
            <NavLink end className={({ isActive }) => (isActive ? 'is-active' : '')} to={adminPaths.overview}>
              현황
            </NavLink>
            <NavLink className={({ isActive }) => (isActive ? 'is-active' : '')} to={adminPaths.egress}>
              녹화(Egress)
            </NavLink>
          </nav>
          <div>
            <Outlet />
          </div>
        </div>
      </main>
    </>
  )
}
