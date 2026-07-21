import { isMockApiEnabled } from '@/shared/config/runtime'

interface DataSourceRequests<T> {
  mock: () => T | Promise<T>
  http: () => T | Promise<T>
}

export function requestByDataSource<T>({ mock, http }: DataSourceRequests<T>): Promise<T> {
  return Promise.resolve(isMockApiEnabled ? mock() : http())
}

export function selectDataSource<T>(mock: T, http: T): T {
  return isMockApiEnabled ? mock : http
}

export const activeDataSource = isMockApiEnabled ? 'mock' : 'http'
