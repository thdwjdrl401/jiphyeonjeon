export type MenuId = 'home' | 'history'

export interface MenuItem {
  id: MenuId
  name: string
  path: string
}

export interface MenuContextValue {
  activeMenuId: MenuId
  menus: readonly MenuItem[]
}
