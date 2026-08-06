import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { isNavigationItemActive, navigationItemsByRole, type NavigationItem } from '@/app/router/navigation'
import { publicPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import NotificationBell from '@/features/notification/NotificationBell'
import ProfileMenu from '@/features/profile/ProfileMenu'
import BrandLink from './BrandLink'

export default function GlobalHeader() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const { user, status } = useAuth()
  const { pathname } = useLocation()

  /**
   * 역할 메뉴는 로그인 상태가 확정된 뒤에만 낸다. status가 'loading'인 동안 학생 메뉴를
   * 먼저 그려 두면 강사 계정에서 잘못된 메뉴가 한 번 스쳐 보인다 — 그때는 공개 메뉴만 낸다.
   */
  const navigationItems: NavigationItem[] = user
    ? navigationItemsByRole[user.role]
    : [navigationItemsByRole.STUDENT[0]]

  const closeMenu = () => setIsMenuOpen(false)

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
                {/* 프로필 → 알림 순. 알림을 프로필 오른쪽 끝에 두면 "내 계정 영역"이 프로필 하나로 먼저 읽힌다. */}
                <ProfileMenu onNavigate={closeMenu} />
                <NotificationBell />
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
        </div>
      </div>
    </header>
  )
}
