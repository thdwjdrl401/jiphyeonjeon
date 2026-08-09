import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalAudioTrack } from 'livekit-client'
import MicrophoneLevelMeter from '@/features/live-session/MicrophoneLevelMeter'

/** 지금 마이크에서 들어오고 있다고 칠 진폭. 테스트가 소리를 만들어 넣는 손잡이다. */
let amplitude = 0
let analyserFails = false
const cleanup = vi.fn(async () => {})

vi.mock('livekit-client', () => ({
  createAudioAnalyser: () => {
    if (analyserFails) throw new Error('Audio Context not supported on this browser')
    return {
      analyser: {
        fftSize: 8,
        getFloatTimeDomainData: (out: Float32Array) => {
          // 진폭이 amplitude인 구형파. RMS가 곧 amplitude가 된다.
          for (let i = 0; i < out.length; i += 1) out[i] = i % 2 === 0 ? amplitude : -amplitude
        },
      },
      cleanup,
    }
  },
}))

const track = {} as LocalAudioTrack

describe('마이크 입력 게이지', () => {
  beforeEach(() => {
    amplitude = 0
    analyserFails = false
    cleanup.mockClear()
  })

  it('마이크가 없으면 켜라고 안내한다', () => {
    render(<MicrophoneLevelMeter />)
    expect(screen.getByText('마이크를 켜면 여기서 소리를 확인합니다')).toBeInTheDocument()
  })

  it('조용하면 아직 확인되지 않았다고 말한다', async () => {
    render(<MicrophoneLevelMeter track={track} />)
    expect(await screen.findByText('한마디 해 보세요')).toBeInTheDocument()
    await waitFor(() => {
      expect(document.querySelectorAll('.mic-meter__bar i.is-lit')).toHaveLength(0)
    })
  })

  /**
   * 이것이 이 게이지의 존재 이유다. 서버는 "마이크 1개 송출"까지만 확인해 주고, 그 트랙에 소리가
   * 실려 있는지는 강사가 한마디 해 봐야 안다.
   */
  it('소리가 들어오면 칸이 차고 확인됐다고 말한다', async () => {
    amplitude = 0.2 // 대략 -14 dBFS. 보통 말소리보다 조금 큰 정도.
    render(<MicrophoneLevelMeter track={track} />)

    expect(await screen.findByText('소리가 들어옵니다')).toBeInTheDocument()
    await waitFor(() => {
      expect(document.querySelectorAll('.mic-meter__bar i.is-lit').length).toBeGreaterThan(7)
    })
  })

  /** 한 번 확인된 사실은 유지한다 — 말을 멈췄다고 "안 들린다"로 되돌아가면 판정이 깜빡인다. */
  it('말을 멈춰도 확인된 사실은 남는다', async () => {
    amplitude = 0.2
    render(<MicrophoneLevelMeter track={track} />)
    await screen.findByText('소리가 들어옵니다')

    amplitude = 0
    await waitFor(() => {
      expect(document.querySelectorAll('.mic-meter__bar i.is-lit')).toHaveLength(0)
    })
    expect(screen.getByText('소리가 들어옵니다')).toBeInTheDocument()
  })

  it('화면을 떠나면 오디오 컨텍스트를 닫는다', async () => {
    const view = render(<MicrophoneLevelMeter track={track} />)
    await screen.findByText('한마디 해 보세요')
    view.unmount()
    expect(cleanup).toHaveBeenCalled()
  })

  /** Web Audio가 없는 브라우저에서 게이지 하나 때문에 점검 화면이 깨지면 안 된다. */
  it('Web Audio가 없으면 게이지만 접는다', async () => {
    analyserFails = true
    render(<MicrophoneLevelMeter track={track} />)
    await waitFor(() => {
      expect(document.querySelector('.mic-meter')).toBeNull()
    })
  })

  it('장치를 바꾸면 배선을 다시 만든다', async () => {
    /*
     * LiveKit은 장치를 바꿀 때 <b>같은 LocalAudioTrack 객체 안의</b> MediaStreamTrack만 갈아끼운다
     * (restartTrack). 이 게이지는 track.attach가 아니라 Web Audio 그래프를 직접 만든 것이라 LiveKit이
     * 다시 붙여 주지 않으므로, track 참조만 보고 있으면 <b>바꾸기 전 마이크</b>를 계속 읽는다.
     * 소리가 안 잡히니 "마이크를 껐다 켜야 반영된다"로 보인다.
     */
    const view = render(<MicrophoneLevelMeter track={track} revision={1} />)
    await waitFor(() => { expect(cleanup).not.toHaveBeenCalled() })

    view.rerender(<MicrophoneLevelMeter track={track} revision={2} />)

    // 옛 배선을 정리했다 = 새로 만들었다.
    await waitFor(() => { expect(cleanup).toHaveBeenCalled() })
  })

  it('바뀐 것이 없으면 배선을 다시 만들지 않는다', async () => {
    // 리렌더마다 AudioContext를 새로 만들면 브라우저가 컨텍스트 수를 제한해 결국 실패한다.
    const view = render(<MicrophoneLevelMeter track={track} revision={1} />)
    view.rerender(<MicrophoneLevelMeter track={track} revision={1} />)

    await waitFor(() => { expect(screen.getByText(/한마디 해 보세요|소리가 들어옵니다/)).toBeInTheDocument() })
    expect(cleanup).not.toHaveBeenCalled()
  })
})
