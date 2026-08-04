import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dismissBrowserPushPrompt,
  wasBrowserPushPromptDismissedRecently,
} from '@/features/notification/browserPushPromptStorage'

/**
 * "나중에" 스누즈. 브라우저 지문 대신 <b>닫은 시각</b> 하나만 남기고, 그 시각을 기준으로
 * 7일간만 억누른다는 정책을 지킨다.
 */
describe('browserPushPromptStorage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('닫은 적이 없으면 다시 보여도 된다', () => {
    expect(wasBrowserPushPromptDismissedRecently()).toBe(false)
  })

  it('방금 닫았으면 7일 안에는 다시 보여 주지 않는다', () => {
    dismissBrowserPushPrompt()

    expect(wasBrowserPushPromptDismissedRecently()).toBe(true)
  })

  it('7일이 지나면 다시 보여도 된다', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    dismissBrowserPushPrompt()

    vi.setSystemTime(new Date('2026-01-08T00:00:01Z'))

    expect(wasBrowserPushPromptDismissedRecently()).toBe(false)
  })

  it('저장된 값이 손상되어 있으면 다시 보여 준다', () => {
    localStorage.setItem('liveclass.browserPushPrompt.dismissedAt', 'not-a-number')

    expect(wasBrowserPushPromptDismissedRecently()).toBe(false)
  })
})
