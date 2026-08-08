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

function formatTimeLabel(sessionMs: number) {
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

/** 확정 세그먼트 하나(caption.segment.final). `text`가 누적 델타를 덮어쓰는 권위 있는 최종 텍스트다. */
interface CaptionSegmentState {
  segmentIndex: number
  lastSequence: number
  text: string
  startStreamElapsedMs: number
  endStreamElapsedMs: number
  boundaryReason: string
  sessionMs: number | null
  anchoredSessionMs: number | null
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
    anchoredSessionMs: number | null
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
    const { sttSessionId, sequence, streamElapsedMs, sessionMs, anchoredSessionMs, text } = event.payload
    const current = state.lines.get(sttSessionId)
    if (current?.deltas.has(sequence)) return state
    const isNewLine = !current
    const { lines, nextOrder, line } = ensureLine(state, sttSessionId)
    line.deltas.set(sequence, {
      text,
      streamElapsedMs,
      sessionMs: sessionMs ?? null,
      anchoredSessionMs: anchoredSessionMs ?? null,
    })
    if (isNewLine) pruneOldestLines(lines)
    return { lines, nextOrder }
  }
  if (event.type === 'caption.segment.final') {
    // 확정 세그먼트: 이 segmentIndex를 권위 있는 최종 텍스트로 기록한다(같은 index 재전달은 last-wins).
    const { sttSessionId, segmentIndex, lastSequence, text, startStreamElapsedMs, endStreamElapsedMs, boundaryReason, sessionMs, anchoredSessionMs } = event.payload
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
      anchoredSessionMs: anchoredSessionMs ?? null,
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
/** 한 자막 조각이 놓인 시각축. `anchored`면 정확값이라 STT 지연 보정을 걸지 않는다. */
interface Axis {
  startMs: number
  synced: boolean
  anchored: boolean
}

/** stream-local 축으로 물러난다 — 세션 축이 아니라 위치 동기화 대상이 아니다. */
function unsynced(startMs: number): Axis {
  return { startMs, synced: false, anchored: false }
}

/**
 * 확정 세그먼트의 시작 시각을 **세션 축**으로 옮긴다. 좋은 축부터 차례로 고른다.
 *
 * <p>1. `anchoredSessionMs` — 서버가 `caption.stream.started` 앵커로 환산한 <b>정확한</b> 세그먼트 시작
 * (ADR-0052 앵커, ADR-0053 후속). 근사가 아니므로 보정 없이 그대로 쓴다.
 *
 * <p>2. `sessionMs` — 앵커가 없을 때의 근사. 이 값은 `segment.final`이 <b>도착한</b> 시각이라 구간의
 * <b>끝</b>에 대응한다. 두 축은 원점만 다르고 속도가 같아 구간 길이가 양쪽에서 동일하므로, 끝에서 길이를
 * 빼면 시작이 나온다. stream-local을 세션-ms로 직접 환산하는 것이 아니라(CONTRACT §3-4 금지) 세션 축
 * 안에서 되짚는 것이다. 도착 기준이라 STT 지연만큼 늦어 보정 대상이다.
 *
 * <p>3. 둘 다 없으면 raw stream-local. 위치 동기화가 불가능해 그대로 노출된다(ADR-0045 §4).
 */
function segmentAxis(segment: CaptionSegmentState): Axis {
  if (segment.anchoredSessionMs != null) {
    return { startMs: segment.anchoredSessionMs, synced: true, anchored: true }
  }
  if (segment.sessionMs == null) return unsynced(segment.startStreamElapsedMs)
  const durationMs = Math.max(0, segment.endStreamElapsedMs - segment.startStreamElapsedMs)
  return { startMs: Math.max(0, segment.sessionMs - durationMs), synced: true, anchored: false }
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
        // 끝은 시작 + 구간 길이다. 구간 길이는 어느 축에서도 같으므로 시작만 옮기면 끝은 따라온다.
        const durationMs = Math.max(0, segment.endStreamElapsedMs - segment.startStreamElapsedMs)
        views.push({
          segmentId: `${line.sttSessionId}#${segment.segmentIndex}`,
          startMs: axis.startMs,
          endMs: axis.startMs + durationMs,
          at: formatTimeLabel(axis.startMs),
          text: segment.text,
          termReferences: [],
          pending: false,
          synced: axis.synced,
          anchored: axis.anchored,
        })
        if (segment.segmentIndex > maxSegmentIndex) maxSegmentIndex = segment.segmentIndex
        if (maxLastSequence == null || segment.lastSequence > maxLastSequence) maxLastSequence = segment.lastSequence
      }

      // 2. 진행 중 조각 — max lastSequence보다 큰(아직 확정 안 된) 델타만 이어 붙인다.
      // 한 델타의 시각은 그 조각을 **내보낸** 시점이라, 그 조각의 말이 **시작된** 시점은 직전 델타의 시각에
      // 가깝다. 그래서 진행 중 조각의 시작 시각으로 첫 진행중 델타의 직전 델타 시각을 쓴다(첫 델타면 자기 시각).
      // 시각 축은 세그먼트와 같은 우선순위다 — 앵커(정확) > 근사 sessionMs > stream-local fallback.
      const sequences = [...line.deltas.keys()].sort((left, right) => left - right)
      let previousMs: number | null = null
      let partialText = ''
      let partialStartMs: number | null = null
      let partialAxis: Axis | null = null
      let started = false
      for (const sequence of sequences) {
        const delta = line.deltas.get(sequence)!
        const axis: Axis = delta.anchoredSessionMs != null
          ? { startMs: delta.anchoredSessionMs, synced: true, anchored: true }
          : delta.sessionMs != null
            ? { startMs: delta.sessionMs, synced: true, anchored: false }
            : unsynced(delta.streamElapsedMs)
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
          anchored: partialAxis?.anchored ?? false,
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
  return captions.filter((caption) => !caption.synced || caption.startMs <= ceilingFor(caption, positionMs))
}

/**
 * 그 자막을 노출해도 되는 상한.
 *
 * <p>앵커 축(`anchored`)은 실제 발화 시각이라 재생 위치를 그대로 상한으로 쓴다. 근사 축은 도착 시각
 * 기준이라 발화보다 지연만큼 늦으므로, 그 지연을 더한 지점까지 열어야 말이 들리는 순간에 뜬다.
 * 정확값에 같은 보정을 걸면 오히려 지연만큼 이르게 떠 버린다.
 */
function ceilingFor(caption: CaptionView, positionMs: number): number {
  return caption.anchored ? positionMs : positionMs + CAPTION_STT_LAG_MS
}

/**
 * 자막의 시각 라벨을 눌렀을 때 실제로 이동할 세션-ms.
 *
 * <p><b>앵커 축(`anchored`)은 보정하지 않는다.</b> startMs가 실제 발화 시작이라 그 자리가 곧 목표다.
 * 여기에 지연을 빼면 문장 앞 여백으로 떨어진다.
 *
 * <p>근사 축(`synced`)의 startMs는 도착 시각 기준이라 발화보다 STT 방출 지연만큼 늦다 — 그대로 seek하면
 * 문장 앞부분을 지나친 곳에 떨어져 "정확히 찾아가지 못한다". 지연분을 당겨 문장 시작 직전에 닿게 한다
 * (늦게 도착하는 것보다 조금 이른 편이 회복 가능하다).
 */
/**
 * 자막 옆에 보일 시각 문구.
 *
 * <p>내부 시각(`startMs`)은 <b>세션 축</b>이고, 플레이어 컨트롤바가 보여 주는 것은 <b>미디어 축</b>
 * (녹화 시작이 0)이다. 둘은 `availableFromMs`(세션 시작 → 녹화 시작 간격)만큼 다르다. 라벨을 세션
 * 축 그대로 두면 같은 순간인데 자막에는 03:14, 플레이어에는 03:07이 떠 사람이 어긋난 것으로 읽는다.
 *
 * <p>그래서 <b>보이는 숫자만</b> 미디어 축으로 내린다. 이동·노출 판정은 세션 축 그대로다 — 축을
 * 통일한 이유(채팅·판서·AI 근거가 모두 세션-ms)를 버리지 않으면서 표시만 플레이어에 맞춘다.
 *
 * <p>세션 축이 아닌 fallback 자막(`synced=false`)은 변환하지 않는다. stream-local 값에서 세션 축
 * 간격을 빼면 아무 의미 없는 숫자가 된다.
 */
export function captionDisplayLabel(caption: CaptionView, availableFromMs: number | null): string {
  if (!caption.synced || !availableFromMs) return caption.at
  return formatTimeLabel(Math.max(0, caption.startMs - availableFromMs))
}

export function captionSeekMs(caption: CaptionView): number {
  if (!caption.synced || caption.anchored) return caption.startMs
  return Math.max(0, caption.startMs - CAPTION_STT_LAG_MS)
}
