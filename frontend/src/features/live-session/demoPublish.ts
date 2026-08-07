/**
 * 시연용 송출 소스. 카메라·마이크 대신 <b>MP4 파일</b>을 LiveKit에 올린다(ADR-0100).
 *
 * <p><b>왜 이게 가짜가 아닌가.</b> STT는 브라우저가 아니라 서버에서 돈다 — `realtime-agent`가 방에
 * 참가자로 들어와 강사 오디오 트랙을 구독한다. 그래서 그 트랙이 마이크에서 왔든 파일에서 왔든
 * 파이프라인은 구분하지 않는다. 자막이 진짜로 나오고, 그러면 그 뒤가 전부 따라온다 — 강의 노트,
 * AI 근거, Egress 녹화, 끝나고 생기는 VOD까지.
 *
 * <p><b>무장(arm)과 소스를 나눠 둔 이유.</b> `File`은 새로고침을 넘지 못하는데 무장 여부는
 * `sessionStorage`에 남는다. 그래서 새로고침 뒤에는 "무장됐지만 소스가 없는" 상태가 되고, 그때
 * <b>아무것도 올리지 않는다</b>. 이 비대칭이 안전 장치다 — 파일을 잃었다고 진짜 카메라로 조용히
 * 되돌아가면, 시연 중 새로고침 한 번에 발표자의 실제 방이 수강생 화면에 뜬다.
 */

/**
 * `captureStream()`은 TS의 DOM 타입에 아직 없다(초안 명세라 lib.dom.d.ts에 안 실렸다). Chrome·Edge에는
 * 있고 Safari에는 없으므로 <b>선택적으로</b> 선언한다 — 있다고 단정하면 없는 브라우저에서 런타임에
 * 터지고, 그 자리가 시연 도중이 된다.
 */
declare global {
  interface HTMLMediaElement {
    captureStream?: () => MediaStream
  }
}

/** 무장 여부만 남긴다. 파일 자체는 남길 수 없고, 남길 수 있어도 남기면 안 된다. */
const ARMED_KEY = 'liveclass.demoPublish.armed'

interface DemoTracks {
  video: MediaStreamTrack
  audio: MediaStreamTrack | null
}

let selectedFile: File | null = null
let element: HTMLVideoElement | null = null
let objectUrl: string | null = null
/**
 * 이미 재생 중인 트랙. <b>다시 만들지 않는다</b> — 화질을 바꾸면 트랙을 내렸다 다시 올리는데,
 * 그때 파일을 새로 열면 영상이 처음으로 되감긴다. 시연 도중 화질 한 번 바꿨다고 강의가 처음으로
 * 돌아가면 안 된다.
 */
let tracks: DemoTracks | null = null

export interface DemoPublishState {
  /** 데모로 송출하기로 했는가. 새로고침을 넘어 남는다. */
  armed: boolean
  /** 지금 올릴 수 있는 파일이 있는가. 새로고침하면 false가 된다. */
  ready: boolean
  fileName: string | null
}

function readArmed(): boolean {
  try {
    return sessionStorage.getItem(ARMED_KEY) === '1'
  } catch {
    // 프라이빗 모드 등에서 막힐 수 있다. 그때는 이 탭 안에서만 유효한 무장으로 둔다.
    return selectedFile !== null
  }
}

function writeArmed(armed: boolean): void {
  try {
    if (armed) sessionStorage.setItem(ARMED_KEY, '1')
    else sessionStorage.removeItem(ARMED_KEY)
  } catch {
    // 못 남겨도 이번 탭에서는 selectedFile이 진실을 안다.
  }
}

export function demoPublishState(): DemoPublishState {
  return { armed: readArmed(), ready: selectedFile !== null, fileName: selectedFile?.name ?? null }
}

/** 데모 소스를 정한다. 이 시점부터 장치 대신 이 파일이 올라간다. */
export function armDemoPublish(file: File): void {
  releaseDemoTracks()
  selectedFile = file
  writeArmed(true)
}

/** 데모를 끄고 평소 장치로 돌아간다. */
export function disarmDemoPublish(): void {
  releaseDemoTracks()
  selectedFile = null
  writeArmed(false)
}

/**
 * 재생 중인 element와 objectURL을 정리한다. element를 놓으면 트랙이 죽으므로 <b>송출이 끝난 뒤에만</b>
 * 부른다.
 */
export function releaseDemoTracks(): void {
  tracks = null
  if (element) {
    element.pause()
    element.removeAttribute('src')
    element.load()
    element = null
  }
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
}

export class DemoPublishError extends Error {}

/**
 * 파일을 재생해 트랙을 뽑는다.
 *
 * <p><b>소리를 죽이지 않는다.</b> 진짜 마이크를 안 쓰므로 하울링이 생길 곳이 없고, 발표자가 지금
 * 무엇이 나가고 있는지 귀로 확인할 수 있어야 한다. 강사 브라우저는 `autoSubscribe: false`라 남의
 * 소리를 받지 않으므로 이 파일 소리가 그 자리의 유일한 소리다.
 *
 * <p>`loop`을 켜지만 시연 시간보다 긴 영상을 쓰는 편이 낫다 — 반복하면 STT가 같은 말을 다시 받아
 * 강의 노트가 같은 주제를 두 번 쌓는다.
 */
export async function createDemoTracks(): Promise<DemoTracks> {
  const file = selectedFile
  if (!file) throw new DemoPublishError('데모 영상이 선택되지 않았습니다.')
  // 이미 돌고 있으면 그대로 쓴다. 여기서 다시 열면 영상이 처음으로 되감긴다.
  if (tracks && element && tracks.video.readyState === 'live') return tracks

  releaseDemoTracks()
  const video = document.createElement('video')
  if (typeof video.captureStream !== 'function') {
    throw new DemoPublishError('이 브라우저는 파일 송출을 지원하지 않습니다. Chrome에서 실행해 주세요.')
  }

  objectUrl = URL.createObjectURL(file)
  video.src = objectUrl
  video.loop = true
  video.playsInline = true
  element = video

  try {
    await video.play()
  } catch (error) {
    releaseDemoTracks()
    throw new DemoPublishError(
      error instanceof Error && error.name === 'NotAllowedError'
        ? '브라우저가 자동 재생을 막았습니다. 데모 영상을 다시 선택해 주세요.'
        : '데모 영상을 재생하지 못했습니다. H.264 + AAC로 인코딩된 mp4인지 확인해 주세요.',
    )
  }

  const stream = video.captureStream!()
  const [videoTrack] = stream.getVideoTracks()
  if (!videoTrack) {
    releaseDemoTracks()
    throw new DemoPublishError('영상 트랙이 없습니다. 화면이 있는 파일인지 확인해 주세요.')
  }
  // 오디오가 없으면 자막·노트·AI가 전부 빈 채로 간다. 막지는 않고 화면이 경고한다.
  tracks = { video: videoTrack, audio: stream.getAudioTracks()[0] ?? null }
  return tracks
}

/** 오디오 트랙이 없는 파일인가. 화면이 "자막이 안 나온다"고 미리 말할 근거다. */
export function demoHasAudio(): boolean {
  return tracks?.audio != null
}
