/**
 * 시연용 <b>음성 파일</b> 소스. 강의 도중 마이크 자리에 이 파일을 끼워 넣는다(ADR-0103).
 *
 * <p><b>MP4 데모(ADR-0100)와 다르다.</b> 그쪽은 "데모 모드로 세션을 시작한다"이고 카메라까지 파일에서
 * 온다. 이쪽은 강의 도중 <b>마이크 소스만</b> 바꾼다 — 인사와 채팅은 진짜 마이크로 하고, 화면공유를
 * 켜고 카메라를 끈 뒤 파일을 튼다. 카메라는 진짜 장치 그대로다.
 *
 * <p><b>추가가 아니라 교체다.</b> STT 에이전트는 마이크 publisher를 하나만 받고 둘째가 오면
 * `multiple remote microphone publishers`로 죽는다(`audio_source.py`). 그래서 새 트랙을 publish하지
 * 않고 이미 올라간 트랙을 `replaceTrack`으로 간다 — publication SID가 그대로라 자막이 끊기지 않는다.
 *
 * <p><b>스피커로도 들린다.</b> 강사가 그 소리를 들으며 판서해야 한다. `captureStream()`으로 뽑은
 * 트랙과 로컬 재생은 별개라, 볼륨을 올려 들어도 나가는 소리는 그대로다. 하울링도 없다 — 그 시점에
 * 진짜 마이크는 이미 파일로 대체돼 방 안 소리를 잡지 않는다.
 *
 * <p><b>새로고침은 넘지 못한다.</b> `File`은 자바스크립트 힙에만 있다. 넘기려면 파일 바이트를
 * IndexedDB에 넣어야 하는데, 발표장 노트북에 강의 음성이 남는 쪽을 택하지 않았다. 새로고침하면
 * 다시 고른다.
 */

/** 진행 표시를 몇 ms마다 갱신할지. `timeupdate`는 브라우저마다 간격이 들쭉날쭉하다. */
const TICK_MS = 200

export interface DemoAudioState {
  fileName: string | null
  /** 지금 마이크 자리에 이 파일이 들어가 있는가. */
  live: boolean
  /** 재생 중인가. `live`이면서 일시정지일 수 있다(그동안 무음이 나간다). */
  playing: boolean
  loop: boolean
  positionMs: number
  durationMs: number
}

let file: File | null = null
let element: HTMLAudioElement | null = null
let objectUrl: string | null = null
let captured: MediaStreamTrack | null = null
let loop = false
let ticker: number | null = null

const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

export function subscribeDemoAudio(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function demoAudioState(): DemoAudioState {
  const duration = element?.duration
  return {
    fileName: file?.name ?? null,
    live: captured !== null,
    playing: element !== null && !element.paused && !element.ended,
    loop,
    positionMs: element ? Math.round(element.currentTime * 1000) : 0,
    // 메타데이터를 읽기 전에는 NaN·Infinity다. 그대로 내보내면 재생바가 NaN%가 된다.
    durationMs: duration !== undefined && Number.isFinite(duration) ? Math.round(duration * 1000) : 0,
  }
}

/** 파일을 고른다. 고르는 것만으로는 <b>아무 일도 일어나지 않는다</b> — 재생을 눌러야 마이크가 바뀐다. */
export function selectDemoAudioFile(next: File): void {
  releaseElement()
  file = next
  notify()
}

/** 파일 자체를 버린다. 송출 중이면 먼저 되돌려야 한다(`closeDemoAudioTrack`). */
export function clearDemoAudioFile(): void {
  releaseElement()
  file = null
  notify()
}

export function setDemoAudioLoop(next: boolean): void {
  loop = next
  if (element) element.loop = next
  notify()
}

function stopTicker() {
  if (ticker !== null) {
    window.clearInterval(ticker)
    ticker = null
  }
}

function releaseElement() {
  stopTicker()
  if (element) {
    element.pause()
    element.removeAttribute('src')
    element.load()
  }
  element = null
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
  captured = null
}

/**
 * 재생을 시작하고 마이크 자리에 넣을 트랙을 낸다.
 *
 * <p>`onEnded`는 <b>반복이 꺼져 있을 때만</b> 불린다 — 파일이 끝나면 진짜 마이크로 돌아가라는 신호다.
 * 반복 중에는 `ended`가 아예 발생하지 않는다(HTMLMediaElement.loop).
 */
export async function openDemoAudioTrack(onEnded: () => void): Promise<MediaStreamTrack> {
  if (!file) throw new Error('음성 파일을 먼저 선택해 주세요.')
  if (captured) return captured

  const audio = document.createElement('audio')
  if (typeof audio.captureStream !== 'function') {
    throw new Error('이 브라우저는 파일 송출을 지원하지 않습니다. Chrome 또는 Edge에서 진행해 주세요.')
  }
  objectUrl = URL.createObjectURL(file)
  audio.src = objectUrl
  audio.loop = loop
  // 강사가 들으면서 판서한다. 음소거하면 나가는 소리는 그대로지만 강사가 박자를 못 맞춘다.
  audio.muted = false
  element = audio
  audio.addEventListener('ended', () => {
    stopTicker()
    notify()
    onEnded()
  })

  await audio.play()
  const stream = audio.captureStream!()
  const [track] = stream.getAudioTracks()
  if (!track) {
    releaseElement()
    throw new Error('음성 파일에서 소리를 찾지 못했습니다.')
  }
  captured = track
  ticker = window.setInterval(notify, TICK_MS)
  notify()
  return track
}

export function pauseDemoAudio(): void {
  element?.pause()
  notify()
}

export async function resumeDemoAudio(): Promise<void> {
  await element?.play()
  notify()
}

export function seekDemoAudio(positionMs: number): void {
  if (!element) return
  element.currentTime = Math.max(0, positionMs) / 1000
  notify()
}

/**
 * 송출을 끝내고 트랙을 닫는다. <b>파일은 남긴다</b> — 다시 재생할 수 있어야 한다.
 *
 * <p>캡처한 트랙은 우리가 멈춘다. LiveKit은 `providedByUser`인 트랙을 대신 멈춰 주지 않는다
 * (`LocalTrack.replaceTrack`).
 */
export function closeDemoAudioTrack(): void {
  captured?.stop()
  releaseElement()
  notify()
}
