const mockSetting = import.meta.env.VITE_USE_MOCK_API

export const isMockApiEnabled =
  import.meta.env.MODE === 'test' ||
  mockSetting === 'true' ||
  (import.meta.env.DEV && mockSetting !== 'false')
