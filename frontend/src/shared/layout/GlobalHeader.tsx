import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  adminNavigationItem,
  isNavigationItemActive,
  isProfileAreaActive,
  navigationItemsByRole,
  type NavigationItem,
} from '@/app/router/navigation'
import { getProfilePath, publicPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { USER_ROLE_LABEL } from '@/features/auth/types'
import NotificationBell from '@/features/notification/NotificationBell'
import ProfileAvatar from '@/features/profile/ProfileAvatar'
import BrandLink from './BrandLink'

export default function GlobalHeader() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const { user, status, logout } = useAuth()
  const { pathname } = useLocation()

  /**
   * 역할 메뉴는 로그인 상태가 확정된 뒤에만 낸다. status가 'loading'인 동안 학생 메뉴를
   * 먼저 그려 두면 강사 계정에서 잘못된 메뉴가 한 번 스쳐 보인다 — 그때는 공개 메뉴만 낸다.
   */
  const navigationItems: NavigationItem[] = user
    ? [...navigationItemsByRole[user.role], ...(user.isAdmin ? [adminNavigationItem] : [])]
    : [navigationItemsByRole.STUDENT[0]]

  const closeMenu = () => setIsMenuOpen(false)

  const handleLogout = async () => {
    setIsLoggingOut(true)
    setLogoutError('')
    try {
      await logout()
      closeMenu()
      /*
       * 보호 경로에 있었다면 가드가 `GuestRedirect`로 랜딩페이지에 내려놓는다. 공개 화면에서
       * 로그아웃했다면 보던 자리에 그대로 남는 것이 맞다 — 읽던 것을 빼앗을 이유가 없다.
       * 여기서 한 번 더 옮기면 가드와 목적지를 두고 다투게 된다.
       */
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
          {/*
            데스크톱·모바일이 같은 목록을 쓴다(모바일은 CSS가 세로로 펼친다) —
            역할별 메뉴가 두 곳에서 갈리지 않게 마크업을 하나만 둔다.
          */}
          <nav className="primary-navigation" aria-label="주요 메뉴">
            {navigationItems.map((item) => {
              const isActive = isNavigationItemActive(item, pathname)
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={isActive ? 'is-active' : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={closeMenu}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="header-actions">
            {status === 'loading' ? (
              <span className="header-auth-loading" aria-label="로그인 상태 확인 중" />
            ) : user ? (
              <>
                {/* 알림 → 프로필 순. 프로필 왼쪽에 두면 "내 계정 영역"이 오른쪽 끝에 모인다. */}
                <NotificationBell />
                {/*
                  프로필 영역 전체가 "내 프로필"로 가는 링크다. 이미지만 누를 수 있으면
                  이름·역할을 눌러 본 사람은 아무 일도 일어나지 않는다고 읽는다.
                  아바타는 decorative라 이름을 읽어 주지 못하므로 목적지를 숨은 텍스트로 붙인다.
                */}
                <Link
                  className={`user-chip${isProfileAreaActive(pathname) ? ' is-active' : ''}`}
                  to={getProfilePath(user.role)}
                  aria-current={isProfileAreaActive(pathname) ? 'page' : undefined}
                  onClick={closeMenu}
                >
                  <ProfileAvatar displayName={user.displayName} imageUrl={user.profileImageUrl} decorative />
                  <span className="user-chip__text">
                    <strong>{user.displayName}</strong>
                    <small>{USER_ROLE_LABEL[user.role]}</small>
                  </span>
                  <span className="visually-hidden">내 프로필</span>
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
