import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMenu } from '@/contexts/MenuContext'
import logoUrl from '@/assets/images/liveclass-logo.png'

interface HeaderProps {
  onOpenLogin: () => void
}

export function Header({ onOpenLogin }: HeaderProps) {
  const navigate = useNavigate()
  const { activeMenuId, menus } = useMenu()
  const [searchValue, setSearchValue] = useState('')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const navigateTo = (path: string) => {
    navigate(path)
    setIsMobileMenuOpen(false)
  }

  return (
    <header className="main-header">
      <button className="logo-button" type="button" aria-label="홈으로 이동" onClick={() => navigateTo('/')}>
        <img src={logoUrl} alt="부트캠프" />
      </button>

      <div className="desktop-header-tools">
        <label className="search-field">
          <span className="visually-hidden">검색</span>
          <input
            type="search"
            placeholder="검색"
            value={searchValue}
            onChange={(event) => setSearchValue(event.target.value)}
          />
          <span aria-hidden="true">⌕</span>
        </label>
        <div className="button-wrapper">
          <button type="button">회원가입</button>
          <button className="primary-button" type="button" onClick={onOpenLogin}>로그인</button>
        </div>
      </div>

      <div className="mobile-header-tools">
        <button type="button" aria-label="메뉴 열기" onClick={() => setIsMobileMenuOpen(true)}>☰</button>
        <button type="button" aria-label="검색">⌕</button>
      </div>

      {isMobileMenuOpen && (
        <div className="mobile-sidebar-wrapper">
          <aside className="mobile-sidebar" aria-label="모바일 메뉴">
            <img className="mobile-logo" src={logoUrl} alt="부트캠프" />
            <button className="mobile-sidebar-button primary-button" type="button" onClick={onOpenLogin}>로그인</button>
            <button className="mobile-sidebar-button" type="button">회원가입</button>
            <nav>
              <ul className="menu-list">
                {menus.map((menu) => (
                  <li key={menu.id}>
                    <button
                      className={activeMenuId === menu.id ? 'active' : ''}
                      type="button"
                      onClick={() => navigateTo(menu.path)}
                    >
                      {menu.name}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
          <button
            className="mobile-sidebar-backdrop"
            type="button"
            aria-label="메뉴 닫기"
            onClick={() => setIsMobileMenuOpen(false)}
          />
        </div>
      )}
    </header>
  )
}
