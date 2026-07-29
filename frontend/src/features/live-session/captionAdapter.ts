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

// --- 라이브 델타 스트림 누적 (CONTRACT §3-4 / ADR-0040·0043) ---
//
// 델타는 append-only 증분이고 세그먼트 경계(caption.segment.final)가 계약에 없다. 그래서
// `sttSessionId`(한 STT job attempt) 하나가 곧 한 자막 라인이며, 델타를 sequence 순서로
// 이어 붙여 실시간으로 자라는 라인을 만든다. `streamElapsedMs`는 stream-local(attempt) 시간이라
// 세션 상대 ms로 변환하지 않고 그대로 표시·정렬에 쓴다.

interface CaptionLineState {
  sttSessionId: string
  /** 처음 등장한 순서 — 렌더 순서를 sequence 리셋(retry)과 무관하게 안정적으로 유지한다. */
  order: number
  /** sequence → 증분 텍스트·시간. sequence로 키잉해 at-least-once 중복 전달을 흡수한다. */
  deltas: Map<number, { text: string; streamElapsedMs: number }>
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
    const line = { ...existing, deltas: new Map(existing.deltas) }
    lines.set(sttSessionId, line)
    return { lines, nextOrder: state.nextOrder, line }
  }
  const line: CaptionLineState = {
    sttSessionId,
    order: state.nextOrder,
    deltas: new Map(),
    completed: false,
    lastSequence: null,
  }
  lines.set(sttSessionId, line)
  return { lines, nextOrder: state.nextOrder + 1, line }
}

/**
 * 델타/종료 이벤트 하나를 누적 상태에 반영한다(순수 함수, useState/useReducer로 쓰기 좋게 불변 갱신).
 * 이미 본 sequence의 델타는 무시하고(멱등) 상태 참조를 그대로 돌려준다.
 */
export function reduceCaptionStream(
  state: CaptionStreamState,
  event: CaptionStreamEvent,
): CaptionStreamState {
  if (event.type === 'caption.delta') {
    const { sttSessionId, sequence, streamElapsedMs, text } = event.payload
    const current = state.lines.get(sttSessionId)
    if (current?.deltas.has(sequence)) return state
    const { lines, nextOrder, line } = ensureLine(state, sttSessionId)
    line.deltas.set(sequence, { text, streamElapsedMs })
    return { lines, nextOrder }
  }
  // caption.stream.completed: 라인을 확정(더 이상 델타 없음)으로 표시한다.
  const { sttSessionId, lastSequence } = event.payload
  const { lines, nextOrder, line } = ensureLine(state, sttSessionId)
  line.completed = true
  line.lastSequence = lastSequence
  return { lines, nextOrder }
}

/** 누적 상태를 CaptionDock이 쓰는 CaptionView[]로 편다(등장 순서 유지, 빈 라인 제외). */
export function selectCaptionViews(state: CaptionStreamState): CaptionView[] {
  return [...state.lines.values()]
    .sort((left, right) => left.order - right.order)
    .map((line): CaptionView | null => {
      const sequences = [...line.deltas.keys()].sort((left, right) => left - right)
      if (sequences.length === 0) return null
      const text = sequences.map((sequence) => line.deltas.get(sequence)!.text).join('')
      if (!text) return null
      const elapsed = sequences.map((sequence) => line.deltas.get(sequence)!.streamElapsedMs)
      const startMs = Math.min(...elapsed)
      const endMs = Math.max(...elapsed)
      return {
        // sttSessionId가 라인 정체성이자 안정 key다(같은 attempt의 델타가 한 라인으로 모인다).
        segmentId: line.sttSessionId,
        startMs,
        endMs,
        // streamElapsedMs는 stream-local이므로 그대로 라벨로 쓴다(세션 상대 ms 변환 금지).
        at: formatTimeLabel(startMs),
        text,
        // 델타 계약에는 용어 참조가 없다 — 빈 배열로 두고 CaptionDock은 일반 텍스트로 렌더한다.
        termReferences: [],
        pending: !line.completed,
      }
    })
    .filter((view): view is CaptionView => view !== null)
}
