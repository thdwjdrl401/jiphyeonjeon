import { selectDataSource } from '@/shared/api/dataSource'
import { httpAuthService } from './httpAuthService'
import { mockAuthService } from './mockAuthService'
import type { AuthService } from './authService.interface'

export const authService = selectDataSource<AuthService>(mockAuthService, httpAuthService)

export { httpAuthService } from './httpAuthService'
export type { AuthService } from './authService.interface'
