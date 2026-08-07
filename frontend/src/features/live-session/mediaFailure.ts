/**
 * 장치(마이크·카메라·화면공유) 실패를 <b>강사가 무엇을 하면 되는지</b>로 옮긴다.
 *
 * <p>운영에서 사전 점검 화면이 "Requested device not found"를 그대로 띄웠다. 크롬이
 * `getUserMedia`에 돌려주는 원문이고, 강사에게는 라이브킷이 고장 난 것으로 읽힌다. 실제 원인은
 * 그 컴퓨터에 오디오 입력 장치가 없다는 것이었다 — 권한도 이미 허용돼 있었다.
 *
 * <p>그래서 두 가지를 분리한다.
 * <ul>
 *   <li><b>무엇이 잘못됐나</b>(cause) — 권한 차단인지, 장치가 없는지, 다른 프로그램이 쓰는지</li>
 *   <li><b>무엇을 하면 되나</b>(action) — 사이트 설정을 고치는 일과 마이크를 꽂는 일은 다르다</li>
 * </ul>
 *
 * <p>가장 갈라내기 어려운 건 <b>권한 차단</b>과 <b>권한 창을 닫음</b>이다. 브라우저는 둘 다
 * `NotAllowedError`를 던지는데, 앞은 다시 눌러도 창이 안 뜨고 뒤는 뜬다. 오류만 보면 구분할 수
 * 없으므로 <b>실패 시점의 권한 상태를 같이 받는다</b>.
 */

export type MediaKind = 'microphone' | 'camera' | 'screenShare'

export type MediaFailureCause =
  /** 사이트 권한이 "차단"으로 저장돼 있다. 다시 시도해도 권한 창이 뜨지 않는다. */
  | 'blocked'
  /** 권한 창이 떴는데 허용되지 않았다(닫음 포함). 다시 물어볼 수 있다. */
  | 'dismissed'
  /** 권한은 있는데 장치가 없다. */
  | 'no-device'
  /** 다른 프로그램이 잡고 있다. */
  | 'in-use'
  /** 고른 화질을 장치가 못 낸다. */
  | 'overconstrained'
  /** 브라우저가 이 맥락에서 장치를 내주지 않는다(비보안 연결·정책). */
  | 'unsupported'
  /** 강사가 스스로 그만뒀다. 오류가 아니다. */
  | 'canceled'
  | 'unknown'

/** 실패 시점의 사이트 권한. `unknown`은 브라우저가 조회를 지원하지 않는 경우다(Firefox·Safari). */
export type MediaPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown'

export interface MediaFailure {
  kind: MediaKind
  cause: MediaFailureCause
  /** 한 줄 제목. 무엇이 잘못됐는지. */
  title: string
  /** 왜 그런지. 강사가 엉뚱한 곳을 뒤지지 않게 하는 것이 목적이다. */
  detail: string
  /** 무엇을 하면 되는지. */
  action: string
  /**
   * "다시 시도"를 내줄지. <b>차단 상태에서는 내주지 않는다</b> — 눌러도 아무 일이 일어나지 않는
   * 버튼은 강사에게 "브라우저 밖에서 할 일이 있다"는 사실을 감춘다.
   */
  retryable: boolean
  /** 브라우저 설정을 직접 고쳐야 하는 상태. 화면이 안내를 더 크게 보여줄 근거가 된다. */
  needsBrowserSetting: boolean
}

const DEVICE_LABEL: Record<MediaKind, string> = {
  microphone: '마이크',
  camera: '카메라',
  screenShare: '화면 공유',
}

/** 크롬·엣지의 사이트 설정 경로. 강사가 실제로 클릭할 수 있는 말로 적는다. */
const SITE_SETTINGS_HINT = '주소창 왼쪽 자물쇠 아이콘 › 사이트 설정에서'

function errorName(error: unknown) {
  return error instanceof Error || (typeof error === 'object' && error !== null && 'name' in error)
    ? String((error as { name?: unknown }).name ?? '')
    : ''
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : ''
}

/**
 * 오류와 권한 상태를 합쳐 원인을 하나로 정한다.
 *
 * <p>`NotAllowedError`가 갈라지는 자리다. 권한이 `denied`면 차단이라 다시 물어볼 수 없고,
 * 그 밖(`prompt`·`granted`·조회 불가)이면 창을 닫았거나 일회성 허용이 끝난 것이라 다시 뜬다.
 * <b>화면 공유는 예외다</b> — 공유 대상 선택 창을 닫아도 같은 오류가 오는데, 그건 실패가 아니라
 * 강사의 선택이다.
 */
export function classifyMediaError(
  error: unknown,
  kind: MediaKind,
  permission: MediaPermissionState,
): MediaFailureCause {
  const name = errorName(error)
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    if (kind === 'screenShare') return 'canceled'
    return permission === 'denied' ? 'blocked' : 'dismissed'
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'no-device'
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'in-use'
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') return 'overconstrained'
  if (name === 'AbortError') return kind === 'screenShare' ? 'canceled' : 'in-use'
  // navigator.mediaDevices가 없으면 접근 단계에서 TypeError가 난다 — 비보안 연결(http)이 대표적이다.
  if (name === 'SecurityError' || name === 'TypeError') return 'unsupported'
  return 'unknown'
}

export function describeMediaFailure(
  error: unknown,
  kind: MediaKind,
  permission: MediaPermissionState = 'unknown',
): MediaFailure {
  const cause = classifyMediaError(error, kind, permission)
  const device = DEVICE_LABEL[kind]
  const base = { kind, cause }

  switch (cause) {
    case 'blocked':
      return {
        ...base,
        title: `${device} 권한이 차단돼 있습니다`,
        detail: `이 사이트의 ${device} 사용이 "차단"으로 저장돼 있어, 다시 시도해도 권한 창이 뜨지 않습니다.`,
        action: `${SITE_SETTINGS_HINT} ${device}를 "허용"으로 바꾼 뒤 새로고침해 주세요.`,
        retryable: false,
        needsBrowserSetting: true,
      }
    case 'dismissed':
      return {
        ...base,
        title: `${device} 사용을 허용해 주세요`,
        detail: `권한 창에서 허용되지 않아 ${device}를 켜지 못했습니다. "이번만 허용"을 골랐다면 그 허용이 끝났을 수도 있습니다.`,
        action: '다시 시도를 누르면 권한 창이 한 번 더 뜹니다.',
        retryable: true,
        needsBrowserSetting: false,
      }
    case 'no-device':
      return {
        ...base,
        title: `${device}를 찾지 못했습니다`,
        detail: `권한 문제가 아닙니다. 이 컴퓨터에 연결된 ${device} 장치가 없습니다.`,
        action: `${device}를 연결하면 자동으로 다시 시도합니다. 연결돼 있는데도 이 안내가 보이면 운영체제의 ${device} 접근 설정을 확인해 주세요.`,
        retryable: true,
        needsBrowserSetting: false,
      }
    case 'in-use':
      return {
        ...base,
        title: `다른 프로그램이 ${device}를 쓰고 있습니다`,
        detail: `${device}를 한 번에 하나의 프로그램만 쓸 수 있는 상태입니다.`,
        action: '화상회의·녹음 프로그램을 닫은 뒤 다시 시도해 주세요.',
        retryable: true,
        needsBrowserSetting: false,
      }
    case 'overconstrained':
      return {
        ...base,
        title: `${device}가 선택한 화질을 지원하지 않습니다`,
        detail: '장치가 낼 수 있는 해상도를 넘는 값을 요청했습니다.',
        action: '송출 품질을 한 단계 낮춘 뒤 다시 시도해 주세요.',
        retryable: true,
        needsBrowserSetting: false,
      }
    case 'unsupported':
      return {
        ...base,
        title: `이 브라우저에서 ${device}를 쓸 수 없습니다`,
        detail: '보안 연결(HTTPS)이 아니거나 브라우저 정책이 장치 접근을 막고 있습니다.',
        action: '크롬 또는 엣지 최신 버전에서 https 주소로 다시 접속해 주세요.',
        retryable: false,
        needsBrowserSetting: true,
      }
    case 'canceled':
      return {
        ...base,
        title: `${device}를 시작하지 않았습니다`,
        detail: '선택 창이 닫혔습니다.',
        action: '필요하면 다시 눌러 주세요.',
        retryable: true,
        needsBrowserSetting: false,
      }
    default:
      return {
        ...base,
        title: `${device}를 시작하지 못했습니다`,
        // 원문을 버리지 않는다. 분류에 없는 오류일 때 이 한 줄이 유일한 단서다.
        detail: errorMessage(error) || '알 수 없는 오류입니다.',
        action: '다시 시도해도 같으면 브라우저를 새로 열어 주세요.',
        retryable: true,
        needsBrowserSetting: false,
      }
  }
}

/**
 * 권한이 이미 차단돼 있는지 <b>요청하기 전에</b> 본다.
 *
 * <p>`navigator.permissions`가 마이크·카메라를 모르는 브라우저가 있어(Firefox의 camera 등)
 * 던지는 경우를 `unknown`으로 받는다. `unknown`은 "모른다"이지 "없다"가 아니므로, 호출부는
 * 이 값으로 요청을 막지 않는다.
 */
export async function queryMediaPermission(kind: 'microphone' | 'camera'): Promise<MediaPermissionState> {
  const permissions = typeof navigator === 'undefined' ? undefined : navigator.permissions
  if (!permissions?.query) return 'unknown'
  try {
    const status = await permissions.query({ name: kind as PermissionName })
    return status.state
  } catch {
    return 'unknown'
  }
}

/**
 * 권한이 바뀌면 알려 준다. 강사가 사이트 설정을 고치고 돌아왔을 때 화면이 스스로 회복하는 근거다.
 *
 * <p>"이번만 허용"이 끝나 `granted`에서 `prompt`로 돌아가는 것도 여기로 온다.
 */
export function watchMediaPermission(
  kind: 'microphone' | 'camera',
  onChange: (state: MediaPermissionState) => void,
): () => void {
  const permissions = typeof navigator === 'undefined' ? undefined : navigator.permissions
  if (!permissions?.query) return () => undefined

  let status: PermissionStatus | undefined
  let stopped = false
  const handler = () => { if (status && !stopped) onChange(status.state) }

  void permissions
    .query({ name: kind as PermissionName })
    .then((result) => {
      if (stopped) return
      status = result
      result.addEventListener('change', handler)
    })
    .catch(() => undefined)

  return () => {
    stopped = true
    status?.removeEventListener('change', handler)
  }
}

/**
 * 이 종류의 입력 장치가 하나라도 있는지.
 *
 * <p>권한 전에는 라벨이 비지만 <b>존재 여부는 알 수 있다</b> — 이 사건의 핵심 단서였다.
 * 알 수 없으면 `'unknown'`을 준다(있다고도 없다고도 하지 않는다).
 */
export async function hasInputDevice(kind: 'microphone' | 'camera'): Promise<boolean | 'unknown'> {
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
  if (!media?.enumerateDevices) return 'unknown'
  try {
    const devices = await media.enumerateDevices()
    const wanted = kind === 'microphone' ? 'audioinput' : 'videoinput'
    return devices.some((device) => device.kind === wanted)
  } catch {
    return 'unknown'
  }
}

/**
 * 요청하기 전에 미리 막을 수 있는 경우만 골라낸다. 없으면 null이고, 그때는 그냥 요청한다.
 *
 * <p>여기서 걸러 내면 <b>권한 창을 띄우지 않고도</b> 정확한 안내를 낼 수 있다. 특히 차단 상태에서
 * 요청을 보내면 아무 일도 안 일어난 것처럼 보이는데, 그 침묵이 "라이브킷이 죽었다"로 읽혔다.
 */
export function preflightMediaFailure(
  kind: 'microphone' | 'camera',
  permission: MediaPermissionState,
  hasDevice: boolean | 'unknown',
): MediaFailure | null {
  if (permission === 'denied') {
    return describeMediaFailure({ name: 'NotAllowedError' }, kind, 'denied')
  }
  if (hasDevice === false) {
    return describeMediaFailure({ name: 'NotFoundError' }, kind, permission)
  }
  return null
}
