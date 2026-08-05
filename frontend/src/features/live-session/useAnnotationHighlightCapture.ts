import { useCallback, useRef, useState } from 'react'
import type { AnnotationElement } from './annotation'
import { hasHighlight } from './annotationHighlight'
import { captureHighlightImage } from './annotationHighlightCapture'
import { checkHighlightLimit, type HighlightLimitState } from './annotationHighlightLimit'
import { captureAnnotationHighlight } from './annotationHighlightService'

/**
 * 강조 캡처 실행(ADR-0074).
 *
 * <p>판서 레이어가 아니라 <b>스테이지</b>가 이걸 쓴다. 합성에는 영상 프레임이 필요한데 그 video
 * element는 스테이지에 있기 때문이다. 레이어는 "언제 무엇이 강조됐는지"만 알린다.
 *
 * <p><b>확인을 캡처보다 먼저 받는다.</b> 캡처는 메인 스레드에서 export·인코딩을 연달아 돌려 강사
 * 화면이 잠깐 멎고 그동안 판서 op 전송도 밀린다. 강사가 "예"를 누른 뒤에 시작하면 그 멈춤이
 * 의도한 순간에만 생긴다. (라이브 송출 자체는 메인 스레드 밖이라 끊기지 않는다.)
 */

export type HighlightCaptureStatus = 'idle' | 'confirming' | 'capturing' | 'saved' | 'failed'

export interface HighlightCapturePrompt {
  /** 강사에게 물을 문구. */
  message: string
  confirm: () => void
  dismiss: () => void
}

interface Options {
  sessionId: string
  /** 합성할 영상. 화면공유가 있으면 그쪽, 없으면 카메라 — 고르는 것은 스테이지의 몫이다. */
  resolveVideo: () => HTMLVideoElement | null
  onCaptured?: () => void
}

export function useAnnotationHighlightCapture({ sessionId, resolveVideo, onCaptured }: Options) {
  const [status, setStatus] = useState<HighlightCaptureStatus>('idle')
  const [prompt, setPrompt] = useState<HighlightCapturePrompt | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const limitRef = useRef<HighlightLimitState>({ capturedCount: 0, lastCapturedAt: null })
  /** 캡처가 도는 동안 새 요청을 받지 않는다 — 같은 강조로 두 장이 올라가지 않게. */
  const busyRef = useRef(false)

  const run = useCallback(async (elements: readonly AnnotationElement[]) => {
    const video = resolveVideo()
    if (!hasHighlight(elements) || !video) {
      // 강조가 없거나 화면이 없으면 남길 것이 없다. 강사에게 알릴 실패가 아니다.
      setStatus('idle')
      return
    }
    busyRef.current = true
    setStatus('capturing')
    try {
      const image = await captureHighlightImage({ video, elements })
      if (!image) {
        setStatus('failed')
        setNotice('화면을 아직 읽을 수 없어 강조를 남기지 못했습니다.')
        return
      }
      await captureAnnotationHighlight(sessionId, image)
      limitRef.current = {
        capturedCount: limitRef.current.capturedCount + 1,
        lastCapturedAt: Date.now(),
      }
      setStatus('saved')
      setNotice('강조를 남겼습니다.')
      onCaptured?.()
    } catch (error) {
      console.warn('강조 캡처 실패', error)
      setStatus('failed')
      setNotice('강조를 남기지 못했습니다.')
    } finally {
      busyRef.current = false
    }
  }, [onCaptured, resolveVideo, sessionId])

  /**
   * 판서 레이어가 "강조를 다 그렸다"고 알릴 때 부른다. 여기서는 <b>묻기만</b> 하고, 무거운 일은
   * 강사가 확인한 뒤에 시작한다.
   */
  const onHighlightSettled = useCallback((elements: readonly AnnotationElement[]) => {
    if (busyRef.current) return
    const verdict = checkHighlightLimit(limitRef.current, Date.now())
    if (!verdict.allowed) {
      setNotice(verdict.message)
      return
    }
    setNotice(null)
    setStatus('confirming')
    setPrompt({
      message: '표시한 부분을 AI 근거로 남길까요?',
      confirm: () => {
        setPrompt(null)
        void run(elements)
      },
      dismiss: () => {
        setPrompt(null)
        setStatus('idle')
      },
    })
  }, [run])

  const dismissNotice = useCallback(() => setNotice(null), [])

  return { onHighlightSettled, status, prompt, notice, dismissNotice }
}
