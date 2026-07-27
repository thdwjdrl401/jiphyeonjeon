import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider, useToast } from '@/shared/ui/Toast'

function Trigger({ message, duration }: { message: string; duration?: number }) {
  const toast = useToast()
  return <button type="button" onClick={() => toast.success(message, duration)}>띄우기</button>
}

describe('Toast', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('토스트가 떴다가 지정 시간 후 자동으로 사라진다', () => {
    render(<ToastProvider><Trigger message="저장되었습니다" duration={1000} /></ToastProvider>)

    act(() => { screen.getByRole('button', { name: '띄우기' }).click() })
    expect(screen.getByText('저장되었습니다')).toBeInTheDocument()

    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.queryByText('저장되었습니다')).not.toBeInTheDocument()
  })

  it('닫기 버튼으로 즉시 사라진다', () => {
    render(<ToastProvider><Trigger message="닫아보기" /></ToastProvider>)

    act(() => { screen.getByRole('button', { name: '띄우기' }).click() })
    expect(screen.getByText('닫아보기')).toBeInTheDocument()

    act(() => { screen.getByRole('button', { name: '알림 닫기' }).click() })
    expect(screen.queryByText('닫아보기')).not.toBeInTheDocument()
  })

  it('ToastProvider 밖에서 useToast를 쓰면 에러를 던진다', () => {
    function Orphan() {
      useToast()
      return null
    }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Orphan />)).toThrow('ToastProvider')
    spy.mockRestore()
  })
})
