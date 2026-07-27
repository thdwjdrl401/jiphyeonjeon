import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDetachedSidebarWindow } from '@/features/live-session/useDetachedSidebarWindow'

function createDetachedWindow() {
  const detachedDocument = document.implementation.createHTMLDocument('')
  return {
    document: detachedDocument,
    closed: false,
    addEventListener: vi.fn(),
    close: vi.fn(),
    focus: vi.fn(),
  } as unknown as Window
}

describe('강사 운영 패널 분리 창', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'documentPictureInPicture')
  })

  it('Document Picture-in-Picture 창을 만들고 포털 컨테이너를 준비한다', async () => {
    const detachedWindow = createDetachedWindow()
    const requestWindow = vi.fn().mockResolvedValue(detachedWindow)
    Object.defineProperty(window, 'documentPictureInPicture', {
      configurable: true,
      value: { requestWindow },
    })
    const { result } = renderHook(() => useDetachedSidebarWindow('ses-live-1'))

    await act(() => result.current.open())

    expect(requestWindow).toHaveBeenCalledWith({ width: 420, height: 780 })
    expect(result.current.mode).toBe('picture-in-picture')
    expect(result.current.isDetached).toBe(true)
    expect(result.current.portalContainer).toBe(
      detachedWindow.document.querySelector('.detached-sidebar-root'),
    )

    act(() => result.current.close())
    expect(detachedWindow.close).toHaveBeenCalledOnce()
    expect(result.current.isDetached).toBe(false)
  })
})
