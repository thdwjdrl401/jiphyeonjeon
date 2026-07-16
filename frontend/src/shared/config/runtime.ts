const mockSetting = import.meta.env.VITE_USE_MOCK_API

export const isMockApiEnabled =
  mockSetting === 'true' ||
  ((import.meta.env.DEV || import.meta.env.MODE === 'test') &&
    mockSetting !== 'false')
