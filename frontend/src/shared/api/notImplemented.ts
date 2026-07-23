import { ApiError } from './client'

/**
 * 아직 서버에 없는 엔드포인트 자리.
 *
 * 없는 경로를 그냥 호출하면 404가 오는데, 화면에서는 그게 서버 장애와 구분되지 않는다.
 * 여기로 모으면 (1) 화면이 `code`를 보고 "아직 준비 중"으로 안내할 수 있고,
 * (2) 아직 비어 있는 경로가 코드에서 한눈에 보인다.
 * 서버가 생기면 이 호출을 실제 `apiClient` 호출로 바꾸면 된다.
 *
 * mock 구현체는 그대로 동작하므로 `VITE_USE_MOCK_API=true`에서는 이 경로를 타지 않는다.
 */
export const API_NOT_IMPLEMENTED = 'API_NOT_IMPLEMENTED'

export function notImplemented(endpoint: string): never {
  throw new ApiError(
    `아직 준비 중인 기능입니다. (${endpoint})`,
    501,
    API_NOT_IMPLEMENTED,
  )
}

/** 이 오류가 "서버 장애"가 아니라 "미구현"인가. 화면이 안내 문구를 고를 때 쓴다. */
export function isNotImplemented(error: unknown): boolean {
  return error instanceof ApiError && error.code === API_NOT_IMPLEMENTED
}
