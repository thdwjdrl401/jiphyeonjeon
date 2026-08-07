import { useEffect, useRef, useState } from 'react'
import { createAudioAnalyser, type LocalAudioTrack } from 'livekit-client'
import { SPEAKING_LEVEL, decayLevel, levelFromRms, rmsOf } from './micLevel'

/**
 * 게이지 칸 수. 범위가 40 dB이므로 한 칸이 약 <b>1.7 dB</b>다.
 *
 * <p>14칸(칸당 3.4 dB)일 때는 목소리를 키워도 눈금이 뭉텅뭉텅 뛰어, 마이크가 실제로 반응하는지
 * 읽기 어려웠다. 계측기가 쓰는 굵기(1~3 dB)에 맞춘다.
 */
export const SEGMENTS = 24

/**
 * 마이크로 들어오는 소리를 게이지로 보여 준다. <b>사전 점검의 마지막 한 칸</b>이다.
 *
 * <p>"마이크 1개 송출"까지는 서버가 확인해 주지만, 그 트랙에 <b>소리가 실려 있는지</b>는 아무도
 * 모른다. 운영체제 음소거·엉뚱한 입력 장치·죽은 마이크는 전부 publish에 성공한다. 강사가 한마디
 * 해서 게이지가 올라가는 것을 본 순간에야 그게 확인된다.
 *
 * <p>배선은 livekit의 {@code createAudioAnalyser}를 쓴다(AudioContext 생성·정리를 대신해 준다).
 * 다만 눈금은 <b>시간영역 샘플에서 직접</b> 낸다 — 그쪽이 순수 진폭이라 계산을 시험할 수 있다.
 */
export default function MicrophoneLevelMeter({ track }: { track?: LocalAudioTrack }) {
  const [level, setLevel] = useState(0)
  const [heard, setHeard] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const levelRef = useRef(0)

  useEffect(() => {
    setLevel(0)
    setHeard(false)
    setUnsupported(false)
    levelRef.current = 0
    if (!track) return

    let analyser: AnalyserNode
    let cleanup: () => Promise<void>
    try {
      const created = createAudioAnalyser(track, { fftSize: 2048 })
      analyser = created.analyser
      cleanup = created.cleanup
    } catch {
      // Web Audio가 없는 환경(오래된 브라우저·테스트). 게이지만 접고 나머지 점검은 그대로 둔다.
      setUnsupported(true)
      return
    }

    const samples = new Float32Array(analyser.fftSize)
    let frame = 0
    const tick = () => {
      analyser.getFloatTimeDomainData(samples)
      const next = decayLevel(levelRef.current, levelFromRms(rmsOf(samples)))
      levelRef.current = next
      setLevel(next)
      if (next >= SPEAKING_LEVEL) setHeard(true)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      void cleanup()
    }
  }, [track])

  if (unsupported) return null

  const lit = Math.round(level * SEGMENTS)
  return (
    <div className={`mic-meter${heard ? ' mic-meter--heard' : ''}`}>
      <div className="mic-meter__head">
        <span className="mic-meter__label">마이크 소리</span>
        <span className="mic-meter__verdict">
          {!track ? '마이크를 켜면 여기서 소리를 확인합니다' : heard ? '소리가 들어옵니다' : '한마디 해 보세요'}
        </span>
      </div>
      {/*
        게이지는 눈으로 보는 것이라 값을 읽어 줄 필요가 없다(매 프레임 바뀌는 숫자를 읽어 주면
        스크린리더가 쉬지 못한다). 대신 판정이 바뀌는 순간만 role="status"로 한 번 알린다.
      */}
      <div className="mic-meter__bar" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, index) => (
          <i key={index} className={index < lit ? 'is-lit' : undefined} />
        ))}
      </div>
      <p className="visually-hidden" role="status">
        {heard ? '마이크 소리가 확인되었습니다.' : ''}
      </p>
    </div>
  )
}
