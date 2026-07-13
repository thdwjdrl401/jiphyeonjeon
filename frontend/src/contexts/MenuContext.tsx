import { createContext, useContext, useMemo } from 'react'
import type { PropsWithChildren } from 'react'
import { useLocation } from 'react-router-dom'
import { MENU_ITEMS } from '@/config/menu'
import type { MenuContextValue, MenuId } from '@/types/menu'

const MenuContext = createContext<MenuContextValue | null>(null)

export function MenuProvider({ children }: PropsWithChildren) {
  const { pathname } = useLocation()
  const activeMenuId: MenuId = pathname === '/history' ? 'history' : 'home'

  const value = useMemo<MenuContextValue>(
    () => ({ activeMenuId, menus: MENU_ITEMS }),
    [activeMenuId],
  )

  return <MenuContext.Provider value={value}>{children}</MenuContext.Provider>
}

export function useMenu(): MenuContextValue {
  const context = useContext(MenuContext)
  if (!context) {
    throw new Error('useMenu must be used within a MenuProvider')
  }
  return context
}
