import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminNavigationItem } from '@/app/router/navigation'
import { getProfilePath } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { USER_ROLE_LABEL } from '@/features/auth/types'
import ProfileAvatar from './ProfileAvatar'

interface ProfileMenuProps {
  /** 모바일 햄버거 메뉴가 열려 있을 때, 드롭다운 안에서 이동하거나 로그아웃하면 그 메뉴도 같이 닫는다. */
  onNavigate?: () => void
}

/**
 * 헤더 프로필 칩 + 드롭다운.
 *
 * 칩 전체가 링크였던 이전 버전과 달리, 칩은 이제 트리거 버튼이다 — 기본정보·전체 프로필 이동·
 * 운영 콘솔(관리자)·로그아웃을 한 곳에 모아, 로그아웃 버튼이 더 이상 헤더에 따로 떠 있지 않게 한다.
 */
export default function ProfileMenu({ onNavigate }: ProfileMenuProps) {
  const { user, logout } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState('')
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  if (!user) return null

  const handleLinkClick = () => {
    setIsOpen(false)
    onNavigate?.()
  }

  const handleLogout = async () => {
    setIsLoggingOut(true)
    setLogoutError('')
    try {
      await logout()
      setIsOpen(false)
      onNavigate?.()
    } catch {
      setLogoutError('로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setIsLoggingOut(false)
    }
  }

  return (
    <div className="profile-menu" ref={containerRef}>
      <button
        className="user-chip"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls="profile-dropdown"
        onClick={() => setIsOpen((current) => !current)}
      >
        <ProfileAvatar displayName={user.displayName} imageUrl={user.profileImageUrl} decorative />
        <span className="user-chip__text">
          <strong>{user.displayName}</strong>
          <small>{USER_ROLE_LABEL[user.role]}</small>
        </span>
        <span className="visually-hidden">내 정보</span>
      </button>

      {isOpen && (
        <div className="profile-dropdown" id="profile-dropdown" role="dialog" aria-label="내 정보">
          <div className="profile-dropdown__summary">
            <ProfileAvatar displayName={user.displayName} imageUrl={user.profileImageUrl} decorative />
            <div className="profile-dropdown__summary-text">
              <strong>{user.displayName}</strong>
              <small>{USER_ROLE_LABEL[user.role]}</small>
              <p>{user.email}</p>
            </div>
          </div>

          {/* 운영 콘솔은 role이 아니라 서버 allowlist(isAdmin)로 갈리므로 해당 계정에만 보인다. */}
          {user.isAdmin && (
            <div className="profile-dropdown__links">
              <Link to={adminNavigationItem.to} onClick={handleLinkClick}>{adminNavigationItem.label}</Link>
            </div>
          )}

          {logoutError && <p className="profile-dropdown__error" role="alert">{logoutError}</p>}

          <footer className="profile-dropdown__footer">
            <Link className="profile-dropdown__footer-link" to={getProfilePath(user.role)} onClick={handleLinkClick}>
              내 프로필
            </Link>
            <span className="profile-dropdown__footer-divider" aria-hidden="true" />
            <button
              className="profile-dropdown__footer-link"
              type="button"
              disabled={isLoggingOut}
              onClick={handleLogout}
            >
              {isLoggingOut ? '처리 중' : '로그아웃'}
            </button>
          </footer>
        </div>
      )}
    </div>
  )
}
