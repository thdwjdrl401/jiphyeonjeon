import type {
  CaptionStreamEvent,
  CaptionTermReference,
  CaptionView,
} from './liveSessionService.interface'

export interface ApiCaptionView {
  segmentId?: string
  startMs?: number
  endMs?: number
  at?: string
  text: string
  termReferences?: CaptionTermReference[]
}

function parseTimeLabel(label?: string) {
  if (!label) return 0
  const parts = label.split(':').map(Number)
  if (parts.some(Number.isNaN)) return 0
  return parts.reduce((total, part) => total * 60 + part, 0) * 1000
}

/** ms를 `mm:ss`(1시간 넘으면 `h:mm:ss`)로. 자막 라벨과 같은 규칙이 필요한 곳에서 함께 쓴다. */
export function formatTimeLabel(sessionMs: number) {
  const totalSeconds = Math.floor(sessionMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** API의 용어 참조는 후속 계약이므로, 없는 경우 문자열 추측 없이 일반 자막으로 정규화한다. */
export function normalizeCaption(caption: ApiCaptionView, index: number): CaptionView {
  const startMs = caption.startMs ?? parseTimeLabel(caption.at)
  return {
    segmentId: caption.segmentId ?? `caption-${startMs}-${index}`,
    startMs,
    endMs: caption.endMs ?? startMs + 15_000,
    at: caption.at ?? formatTimeLabel(startMs),
    text: caption.text,
    termReferences: caption.termReferences ?? [],
  }
}

// --- 라이브 델타 스트림 누적 (CONTRACT §3-4 / ADR-0040·0043·0045) ---
//
// 델타는 append-only 증분이고, AI가 확정 세그먼트 경계(caption.segment.final)를 권위 있게 내려 준다
// (ADR-0044 문장부호 휴리스틱 대체). 그래서 `sttSessionId`(한 STT job attempt) 하나가 한 자막 라인이며,
// 그 라인은 확정 세그먼트들(segmentIndex 순) + 아직 확정 안 된 진행 중 델타 조각 하나로 렌더된다.
// 세그먼트의 `text`가 누적 델타를 덮어쓰는 최종 텍스트이고, `lastSequence`보다 큰 sequence의 델타만
// 아직 어느 세그먼트에도 안 잡힌 진행 중(pending) 조각이다.
//
// 시각 축: 서버가 함께 주는 근사 `sessionMs`(occurredAt−clockOriginAt)를 우선 쓴다 — HLS 영상 위치와
// 같은 세션 축이라 학생 위치 동기화의 기준이 된다(ADR-0045). sessionMs가 없으면(clockOriginAt 전 등)
// stream-local `streamElapsedMs`로 fallback하고, 그 라인은 위치 동기화 대상이 아니다(synced=false).

/**
 * 누적 라인 상한(롤링 캡). 긴 세션에서 메모리와 CaptionDock의 <article> 수가 무한정 커지지 않게
 * 최근 N개 라인만 보관하고 초과 시 가장 오래된 라인을 drop한다. 학생 위치 동기화에 필요한 앞선 버퍼는
 * HLS 지연분(~수십초)뿐이라 이 캡이면 넉넉하다. 풀 가상 스크롤은 과해서 쓰지 않는다.
 */
export const CAPTION_MAX_LINES = 300

/**
 * STT 방출 지연 보정(ms) — 근사 세션-ms 축의 **체계적 편향**을 상쇄하는 단일 상수다.
 *
 * 근사 sessionMs는 `occurredAt`(agent가 그 조각을 **내보낸** 시각) 기반이라, 실제 발화 시각보다 STT 처리
 * 시간만큼 **늦다**: `startMs ≈ 발화시각 + lag`. 이 편향은 두 곳에 같은 크기로 나타나므로 같은 상수로 푼다.
 *
 * - **노출 시점**: `positionMs >= startMs − lag`일 때 보여야 말이 들리는 순간에 자막이 뜬다(그냥 startMs로
 *   가리면 자막이 소리보다 lag만큼 늦게 뜬다).
 * - **seek 목표**: `startMs − lag`으로 이동해야 문장 **시작**에 닿는다(그냥 startMs로 가면 문장 앞부분을
 *   지나친 곳에 떨어진다).
 *
 * 두 곳이 같은 값이라 자막을 클릭해 seek한 직후에도 그 줄이 경계에 정확히 걸려 사라지지 않는다.
 * 앵커(ADR-0045 후속)가 오면 이 보정은 필요 없어진다.
 */
export const CAPTION_STT_LAG_MS = 1_500

/**
 * 자막 시각을 눌렀을 때 발화 시작보다 이만큼 **뒤로** 떨어뜨린다(ms). **정확 축 전용.**
 *
 * <p><b>노출 시점에는 걸지 않는다.</b> 자막이 화면에 뜨는 타이밍은 발화 시각 그대로가 맞다 —
 * 운영에서 확인했다. 문제는 <b>이동</b>뿐이다: 발화 시작 지점으로 가면 소리가 들리기까지 약 2초가
 * 빈다(운영 다시보기 실측).
 *
 * <p>빈 이유는 그 지점이 <b>말이 들리기 직전</b>이기 때문이다. VAD가 발화 경계를 잡을 때 활성화
 * 프레임만큼 뒤로 물리고, 캡처에서 HLS로 나오기까지 영상이 조금 뒤처지는 것도 겹친다. 노출은
 * 문장 <b>끝</b>을 보므로 이 앞쪽 여백에 영향을 받지 않고, seek만 시작을 겨냥해 드러난다.
 *
 * <p>이 값은 코드가 계산할 수 없다 — VAD 정책과 Egress의 시각 표기에 달렸다. 재보고 넣은 숫자이며,
 * 다른 강의에서 다르게 보이면 조정한다. 너무 키우면 문장 첫 음절을 놓치므로 실측보다 크게 잡지 않는다.
 */
export const CAPTION_SEEK_OFFSET_MS = 2_000


/** 확정 세그먼트 하나(caption.segment.final). `text`가 누적 델타를 덮어쓰는 권위 있는 최종 텍스트다. */
interface CaptionSegmentState {
  segmentIndex: number
  lastSequence: number
  text: string
  startStreamElapsedMs: number
  endStreamElapsedMs: number
  boundaryReason: string
  sessionMs: number | null
  speechSessionMs: number | null
  speechEndSessionMs: number | null
}

interface CaptionLineState {
  sttSessionId: string
  /** 처음 등장한 순서 — 렌더 순서를 sequence 리셋(retry)과 무관하게 안정적으로 유지한다. */
  order: number
  /** sequence → 증분 텍스트·시간. sequence로 키잉해 at-least-once 중복 전달을 흡수한다. */
  deltas: Map<number, {
    text: string
    streamElapsedMs: number
    sessionMs: number | null
  }>
  /** segmentIndex → 확정 세그먼트. 같은 index 재전달은 last-wins(멱등). */
  segments: Map<number, CaptionSegmentState>
  completed: boolean
  lastSequence: number | null
}

export interface CaptionStreamState {
  lines: Map<string, CaptionLineState>
  nextOrder: number
}

export function emptyCaptionStreamState(): CaptionStreamState {
  return { lines: new Map(), nextOrder: 0 }
}

function ensureLine(
  state: CaptionStreamState,
  sttSessionId: string,
): { lines: Map<string, CaptionLineState>; nextOrder: number; line: CaptionLineState } {
  const existing = state.lines.get(sttSessionId)
  const lines = new Map(state.lines)
  if (existing) {
    const line = { ...existing, deltas: new Map(existing.deltas), segments: new Map(existing.segments) }
    lines.set(sttSessionId, line)
    return { lines, nextOrder: state.nextOrder, line }
  }
  const line: CaptionLineState = {
    sttSessionId,
    order: state.nextOrder,
    deltas: new Map(),
    segments: new Map(),
    completed: false,
    lastSequence: null,
  }
  lines.set(sttSessionId, line)
  return { lines, nextOrder: state.nextOrder + 1, line }
}

/** 롤링 캡: 라인 수가 상한을 넘으면 가장 오래된(order 작은) 라인부터 drop한다(제자리 변형, fresh map 전용). */
function pruneOldestLines(lines: Map<string, CaptionLineState>): void {
  if (lines.size <= CAPTION_MAX_LINES) return
  const byOrder = [...lines.values()].sort((left, right) => left.order - right.order)
  const dropCount = lines.size - CAPTION_MAX_LINES
  for (let index = 0; index < dropCount; index += 1) {
    lines.delete(byOrder[index].sttSessionId)
  }
}

/**
 * 델타/종료 이벤트 하나를 누적 상태에 반영한다(순수 함수, useState/useReducer로 쓰기 좋게 불변 갱신).
 * 이미 본 sequence의 델타는 무시하고(멱등) 상태 참조를 그대로 돌려준다. 새 라인이 생겨 상한을 넘으면
 * 가장 오래된 라인을 drop한다(bounded).
 */
export function reduceCaptionStream(
  state: CaptionStreamState,
  event: CaptionStreamEvent,
): CaptionStreamState {
  if (event.type === 'caption.delta') {
    const { sttSessionId, sequence, streamElapsedMs, sessionMs, text } = event.payload
    const current = state.lines.get(sttSessionId)
    if (current?.deltas.has(sequence)) return state
    const isNewLine = !current
    const { lines, nextOrder, line } = ensureLine(state, sttSessionId)
    line.deltas.set(sequence, {
      text,
      streamElapsedMs,
      sessionMs: sessionMs ?? null,
    })
    if (isNewLine) pruneOldestLines(lines)
    return { lines, nextOrder }
  }
  if (event.type === 'caption.segment.final') {
    // 확정 세그먼트: 이 segmentIndex를 권위 있는 최종 텍스트로 기록한다(같은 index 재전달은 last-wins).
    const { sttSessionId, segmentIndex, lastSequence, text, startStreamElapsedMs, endStreamElapsedMs, boundaryReason, sessionMs, speechSessionMs, speechEndSessionMs } = event.payload
    const isNewLine = !state.lines.has(sttSessionId)
    const { lines, nextOrder, line } = ensureLine(state, sttSessionId)
    line.segments.set(segmentIndex, {
      segmentIndex,
      lastSequence,
      text,
      startStreamElapsedMs,
      endStreamElapsedMs,
      boundaryReason,
      sessionMs: sessionMs ?? null,
      speechSessionMs: speechSessionMs ?? null,
      speechEndSessionMs: speechEndSessionMs ?? null,
    })
    if (isNewLine) pruneOldestLines(lines)
    return { lines, nextOrder }
  }
  // caption.stream.completed: 라인을 확정(더 이상 델타 없음)으로 표시한다.
  const { sttSessionId, lastSequence } = event.payload
  const isNewLine = !state.lines.has(sttSessionId)
  const { lines, nextOrder, line } = ensureLine(state, sttSessionId)
  line.completed = true
  line.lastSequence = lastSequence
  if (isNewLine) pruneOldestLines(lines)
  return { lines, nextOrder }
}

/**
 * 누적 상태를 CaptionDock이 쓰는 CaptionView[]로 편다(등장 순서 유지, 빈 라인 제외).
 *
 * 한 라인(sttSessionId)당:
 *  1. 확정 세그먼트(caption.segment.final)마다 권위 있는 CaptionView 하나 — segmentIndex 순, pending=false.
 *     시각 축은 델타와 같다(ADR-0045 §4): 서버가 준 근사 `sessionMs`가 있으면 세션 축(synced=true),
 *     없으면 raw `startStreamElapsedMs`로 fallback(synced=false). {@link segmentStartMs} 참고.
 *  2. 아직 어느 세그먼트에도 안 잡힌(=sequence > 세그먼트들의 max lastSequence) 델타를 이어 붙인 진행 중 조각
 *     하나 — pending(라인이 completed면 false). 나중 세그먼트가 이 조각을 덮으면 조각은 줄거나 사라진다.
 *     세그먼트가 아직 없으면 델타 전체가 이 진행 중 조각이다(과거 동작과 같되 문장부호 분할은 없다).
 */
/** 한 자막 조각이 놓인 시각축. */
interface Axis {
  startMs: number
  endMs: number
  synced: boolean
  exact: boolean
}

/** stream-local 축으로 물러난다 — 세션 축이 아니라 위치 동기화 대상이 아니다. */
function unsynced(startMs: number, endMs: number): Axis {
  return { startMs, endMs, synced: false, exact: false }
}

/**
 * 확정 세그먼트의 시작 시각을 **세션 축**으로 옮긴다.
 *
 * <p><b>`anchoredSessionMs`는 쓰지 않는다</b>(ADR-0104를 되돌린다). 서버는 계속 내려 주지만 그 값이
 * 실제 발화 시각과 맞지 않는다 — 운영 데이터로 확인했다. 최근 세션 5건에서 앵커 축이 도착 축보다
 * <b>3.7초에서 24.1초까지</b> 이르고, 그 폭이 세션마다 다르다. 세션 안에서는 거의 일정하므로 원점
 * 문제이며, {@code audioStartedAt}(앵커가 가리키는 0)과 {@code streamElapsedMs}가 세는 0이 같은
 * 순간이 아니라는 뜻이다. 그 차이는 "에이전트가 붙은 뒤 실제 오디오가 흐르기까지"라 세션마다 다르다.
 *
 * <p>정확해 보이는 값을 쓰다 라이브 자막이 통째로 어긋났다. 근거가 서기 전까지는 <b>덜 정확해도
 * 어긋나지 않는 축</b>을 쓴다 — AI팀과 {@code audioStartedAt} 의미를 맞춘 뒤 되돌린다.
 *
 * <p>쓰는 축은 `sessionMs`(근사)다. 이 값은 `segment.final`이 <b>도착한</b> 시각이라 구간의 <b>끝</b>에
 * 대응한다. 두 축은 원점만 다르고 속도가 같아 구간 길이가 양쪽에서 동일하므로, 끝에서 길이를 빼면
 * 시작이 나온다. stream-local을 세션-ms로 직접 환산하는 것이 아니라(CONTRACT §3-4 금지) 세션 축
 * 안에서 되짚는 것이다. 도착 기준이라 STT 지연만큼 늦어 보정 대상이다.
 *
 * <p>`sessionMs`도 없으면 raw stream-local. 위치 동기화가 불가능해 그대로 노출된다(ADR-0045 §4).
 */
function segmentAxis(segment: CaptionSegmentState): Axis {
  const durationMs = Math.max(0, segment.endStreamElapsedMs - segment.startStreamElapsedMs)
  if (segment.speechSessionMs != null) {
    // 발화 벽시계 기반 정확값(ADR-0107). 끝도 함께 오므로 추정하지 않는다 — 세그먼트 안에도 짧은
    // 무음이 있어 "시작 + 오디오 길이"로는 끝이 조금씩 이르게 잡힌다.
    return {
      startMs: segment.speechSessionMs,
      endMs: segment.speechEndSessionMs ?? segment.speechSessionMs + durationMs,
      synced: true,
      exact: true,
    }
  }
  if (segment.sessionMs == null) {
    return unsynced(segment.startStreamElapsedMs, segment.endStreamElapsedMs)
  }
  const startMs = Math.max(0, segment.sessionMs - durationMs)
  return { startMs, endMs: startMs + durationMs, synced: true, exact: false }
}

export function selectCaptionViews(state: CaptionStreamState): CaptionView[] {
  return [...state.lines.values()]
    .sort((left, right) => left.order - right.order)
    .flatMap((line): CaptionView[] => {
      const views: CaptionView[] = []
      // 1. 확정 세그먼트 — segmentIndex 순으로 권위 있는 라인을 낸다.
      const segments = [...line.segments.values()].sort((left, right) => left.segmentIndex - right.segmentIndex)
      let maxSegmentIndex = -1
      let maxLastSequence: number | null = null
      for (const segment of segments) {
        const axis = segmentAxis(segment)
        views.push({
          segmentId: `${line.sttSessionId}#${segment.segmentIndex}`,
          startMs: axis.startMs,
          endMs: axis.endMs,
          at: formatTimeLabel(axis.startMs),
          text: segment.text,
          termReferences: [],
          pending: false,
          synced: axis.synced,
          exact: axis.exact,
        })
        if (segment.segmentIndex > maxSegmentIndex) maxSegmentIndex = segment.segmentIndex
        if (maxLastSequence == null || segment.lastSequence > maxLastSequence) maxLastSequence = segment.lastSequence
      }

      // 2. 진행 중 조각 — max lastSequence보다 큰(아직 확정 안 된) 델타만 이어 붙인다.
      // 한 델타의 시각은 그 조각을 **내보낸** 시점이라, 그 조각의 말이 **시작된** 시점은 직전 델타의 시각에
      // 가깝다. 그래서 진행 중 조각의 시작 시각으로 첫 진행중 델타의 직전 델타 시각을 쓴다(첫 델타면 자기 시각).
      // 시각 축은 세그먼트와 같다 — 근사 sessionMs > stream-local fallback(앵커는 위 사유로 미사용).
      const sequences = [...line.deltas.keys()].sort((left, right) => left - right)
      let previousMs: number | null = null
      let partialText = ''
      let partialStartMs: number | null = null
      let partialAxis: Axis | null = null
      let started = false
      for (const sequence of sequences) {
        const delta = line.deltas.get(sequence)!
        const axis: Axis = delta.sessionMs != null
          ? { startMs: delta.sessionMs, endMs: delta.sessionMs, synced: true, exact: false }
          : unsynced(delta.streamElapsedMs, delta.streamElapsedMs)
        const isPartial = maxLastSequence == null || sequence > maxLastSequence
        if (isPartial) {
          if (!started) {
            partialStartMs = previousMs ?? axis.startMs
            partialAxis = axis
            started = true
          }
          partialText += delta.text
        }
        previousMs = axis.startMs
      }

      if (started && partialText.trim()) {
        const startMs = partialStartMs ?? 0
        views.push({
          segmentId: `${line.sttSessionId}#${maxSegmentIndex + 1}`,
          startMs,
          endMs: startMs,
          at: formatTimeLabel(startMs),
          text: partialText,
          termReferences: [],
          pending: !line.completed,
          synced: partialAxis?.synced ?? false,
        })
      }

      return views
    })
}

/**
 * CaptionDock에 넘길 자막을 고른다(ADR-0045).
 *
 * <p>기준은 <b>역할이 아니라 재생 위치가 있느냐</b>다. 위치가 있으면 위치 동기화 자막(synced)은
 * 거기까지만 노출한다 — 앞선 자막은 이미 버퍼에 와 있고 위치가 도달하면 드러난다. 위치 축이 아닌
 * fallback 자막(synced=false)은 판단할 수 없어 그대로 보인다.
 *
 * <p><b>비교하는 것은 시작이 아니라 끝(`endMs`)이다.</b> 확정 세그먼트가 담는 것은 문장 <b>전체</b>라,
 * 시작 시각에 내보내면 강사가 말을 꺼내는 순간 그 문장을 끝까지 다 보여 준다 — 4초짜리 문장이면 4초를
 * 앞서 읽게 되어 자막이 이르게 느껴진다. 끝을 기준으로 하면 말이 끝날 무렵 떠서 방송 자막과 같은
 * 감각이 되고, <b>문장 길이에 자동으로 맞춰진다</b>(긴 문장은 더 늦게, 짧은 문장은 빨리). 상수를
 * 하나 더 두지 않고 푸는 방법이기도 하다.
 *
 * <p>진행 중 조각(pending)은 `endMs === startMs`라 이 변경의 영향을 받지 않는다 — 아직 말한 만큼만
 * 담고 있어 즉시 보여도 앞서지 않는다.
 *
 * <p><b>{@code positionMs}가 null이면 전부 노출한다.</b> 라이브 강사 화면처럼 플레이어가 없어
 * 위치를 구할 수 없는 자리다. 한때 이 자리에 {@code isInstructor}가 있었는데, 다시보기에서는
 * 강사도 플레이어를 쓰므로 역할로 판단하면 강사만 미래 자막이 다 보인다 — 물어야 할 것은 처음부터
 * "위치를 아는가"였다.
 */
export function selectVisibleCaptions(
  captions: CaptionView[],
  positionMs: number | null,
): CaptionView[] {
  if (positionMs == null) return captions
  return captions.filter((caption) => !caption.synced || caption.endMs <= ceilingFor(caption, positionMs))
}

/**
 * 그 자막을 노출해도 되는 상한.
 *
 * <p>근사 축은 도착 시각 기준이라 발화보다 STT 지연만큼 늦다. 그 지연을 더한 지점까지 열어야 말이
 * 들리는 순간에 자막이 뜬다.
 */
function ceilingFor(caption: CaptionView, positionMs: number): number {
  // 정확 축은 발화 시각 그 자체라 재생 위치를 그대로 상한으로 쓴다 — 운영에서 이 노출 시점이
  // 맞는 것을 확인했다. 근사 축만 도착 기준의 늦음을 상쇄해 미리 연다.
  return caption.exact ? positionMs : positionMs + CAPTION_STT_LAG_MS
}

/**
 * 자막의 시각 라벨을 눌렀을 때 실제로 이동할 세션-ms.
 *
 * <p>근사 축의 startMs는 도착 시각 기준이라 발화보다 STT 방출 지연만큼 늦다 — 그대로 seek하면 문장
 * 앞부분을 지나친 곳에 떨어져 "정확히 찾아가지 못한다". 지연분을 당겨 문장 시작 직전에 닿게 한다
 * (늦게 도착하는 것보다 조금 이른 편이 회복 가능하다).
 */
export function captionSeekMs(caption: CaptionView): number {
  if (!caption.synced) return caption.startMs
  // 정확 축: 발화 시각으로 가면 소리는 아직 나오지 않았다. 영상이 뒤처진 만큼 더 가야 그 말이 들린다.
  if (caption.exact) return caption.startMs + CAPTION_SEEK_OFFSET_MS
  return Math.max(0, caption.startMs - CAPTION_STT_LAG_MS)
}

/**
 * 자막 옆에 보일 시각 문구.
 *
 * <p><b>이동 목표에서 그대로 파생한다.</b> 라벨은 설명이 아니라 버튼이다 — 누르면 가는 자리를 말해야
 * 한다. {@link captionSeekMs}를 따로 계산하지 않고 그 결과를 변환만 하므로, 보정값을 어떻게 바꾸든
 * "라벨의 숫자 = 눌러서 도착한 플레이어의 숫자"가 깨질 수 없다.
 *
 * <p>축도 맞춘다. 내부 시각은 <b>세션 축</b>이고 플레이어 컨트롤바가 보여 주는 것은 <b>미디어 축</b>
 * (녹화 시작이 0)이라 `availableFromMs`만큼 다르다. 그대로 두면 같은 순간인데 자막에는 03:14,
 * 플레이어에는 03:07이 떠 사람이 어긋난 것으로 읽는다. 이동·노출 판정은 세션 축 그대로이고
 * 보이는 숫자만 내린다.
 *
 * <p>세션 축이 아닌 fallback 자막(`synced=false`)은 변환하지 않는다. stream-local 값에서 세션 축
 * 간격을 빼면 아무 의미 없는 숫자가 된다.
 */
export function captionDisplayLabel(caption: CaptionView, availableFromMs: number | null): string {
  if (!caption.synced) return caption.at
  return formatTimeLabel(Math.max(0, captionSeekMs(caption) - (availableFromMs ?? 0)))
}
