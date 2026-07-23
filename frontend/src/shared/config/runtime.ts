const mockSetting = import.meta.env.VITE_USE_MOCK_API

/** 테스트는 항상 mock 데이터 소스를 쓴다(네트워크 의존 없이 결정적으로 돌아야 한다). */
export const isTestMode = import.meta.env.MODE === 'test'

export const isMockApiEnabled =
  isTestMode || mockSetting === 'true' || (import.meta.env.DEV && mockSetting !== 'false')

/** mock 모드에서는 선택 경계를 우회한 /api 요청도 차단한다. */
export const isNetworkBlocked = isMockApiEnabled
