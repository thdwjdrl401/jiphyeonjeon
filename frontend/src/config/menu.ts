import type { MenuItem } from '@/types/menu'

export const MENU_ITEMS = [
  { id: 'home', name: '홈', path: '/' },
  { id: 'history', name: '지난 회의 이력', path: '/history' },
] as const satisfies readonly MenuItem[]
