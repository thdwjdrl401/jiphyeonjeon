import { useNavigate } from 'react-router-dom'
import { useMenu } from '@/contexts/MenuContext'

export function Sidebar() {
  const navigate = useNavigate()
  const { activeMenuId, menus } = useMenu()

  return (
    <aside className="main-sidebar" aria-label="주 메뉴">
      <nav>
        <ul className="menu-list">
          {menus.map((menu) => (
            <li key={menu.id}>
              <button
                className={activeMenuId === menu.id ? 'active' : ''}
                type="button"
                onClick={() => navigate(menu.path)}
              >
                {menu.name}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  )
}
