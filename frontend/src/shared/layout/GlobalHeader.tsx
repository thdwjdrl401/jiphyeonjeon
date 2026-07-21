import { useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { getRoleHomePath, instructorPaths, publicPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import BrandLink from './BrandLink'

export default function GlobalHeader() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const { user, status, logout } = useAuth()
  const navigate = useNavigate()
  const workspaceHome = user ? getRoleHomePath(user.role) : publicPaths.home
  const profilePath = user?.role === 'INSTRUCTOR' ? instructorPaths.profile : studentPaths.profile

  const closeMenu = () => setIsMenuOpen(false)

  const handleLogout = async () => {
    setIsLoggingOut(true)
    setLogoutError('')
    try {
      await logout()
      closeMenu()
      navigate(publicPaths.home)
    } catch {
      setLogoutError('로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <header className="global-header">
      <div className="page-container header-inner">
        <BrandLink />

        <button
          className="menu-toggle"
          type="button"
          aria-expanded={isMenuOpen}
          aria-controls="global-navigation"
          aria-label={isMenuOpen ? '메뉴 닫기' : '메뉴 열기'}
          onClick={() => setIsMenuOpen((current) => !current)}
        >
          <span />
          <span />
          <span />
        </button>

        <div
          className={`header-navigation${isMenuOpen ? ' is-open' : ''}`}
          id="global-navigation"
        >
          <nav className="primary-navigation" aria-label="주요 메뉴">
            <NavLink
              to={publicPaths.curriculums}
              onClick={closeMenu}
              className={({ isActive }) => (isActive ? 'is-active' : undefined)}
            >
              커리큘럼 탐색
            </NavLink>
            {user && (
              <Link to={workspaceHome} onClick={closeMenu}>
                내 커리큘럼
              </Link>
            )}
            {user?.role === 'INSTRUCTOR' && (
              <Link to={instructorPaths.newCurriculum} onClick={closeMenu}>
                커리큘럼 만들기
              </Link>
            )}
          </nav>

          <div className="header-actions">
            {status === 'loading' ? (
              <span className="header-auth-loading" aria-label="로그인 상태 확인 중" />
            ) : user ? (
              <>
                <Link className="user-chip" to={profilePath} onClick={closeMenu}>
                  <span className="user-avatar" aria-hidden="true">
                    {user.displayName.slice(0, 1)}
                  </span>
                  <span>
                    <strong>{user.displayName}</strong>
                    <small>{user.role === 'INSTRUCTOR' ? '강사' : '학생'}</small>
                  </span>
                </Link>
                <button
                  className="button button--ghost button--small"
                  type="button"
                  disabled={isLoggingOut}
                  onClick={handleLogout}
                >
                  {isLoggingOut ? '처리 중' : '로그아웃'}
                </button>
              </>
            ) : (
              <>
                <Link className="button button--ghost button--small" to={publicPaths.login} onClick={closeMenu}>
                  로그인
                </Link>
                <Link className="button button--primary button--small" to={publicPaths.signup} onClick={closeMenu}>
                  무료로 시작하기
                </Link>
              </>
            )}
          </div>
          {logoutError && <p className="header-error" role="alert">{logoutError}</p>}
        </div>
      </div>
    </header>
  )
}
