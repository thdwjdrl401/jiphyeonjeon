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
/**
 * 누적 텍스트를 발화(문장) 단위로 쪼갠다. 델타 계약에 세그먼트 경계(caption.segment.final)가 없어
 * FE에서 문장부호로 근사한다(ADR-0044 후속: AI팀 segment.final 도입 시 대체). 종결부호로 끝나는
 * 런과 마지막 진행중 조각을 각각 한 문장으로 낸다. startOffset은 원문 내 시작 위치(시간 매핑용).
 */
function splitSentences(text: string): { text: string; startOffset: number }[] {
  const out: { text: string; startOffset: number }[] = []
  const re = /[^.。!?…]*[.。!?…]+["'”’)\]]*\s*/g
  let match: RegExpExecArray | null
  let lastIndex = 0
  while ((match = re.exec(text)) !== null) {
    const trimmed = match[0].trim()
    if (trimmed) out.push({ text: trimmed, startOffset: match.index })
    lastIndex = re.lastIndex
  }
  const rest = text.slice(lastIndex).trim()
  if (rest) out.push({ text: rest, startOffset: lastIndex })
  return out
}

export function selectCaptionViews(state: CaptionStreamState): CaptionView[] {
  return [...state.lines.values()]
    .sort((left, right) => left.order - right.order)
    .flatMap((line): CaptionView[] => {
      const sequences = [...line.deltas.keys()].sort((left, right) => left - right)
      if (sequences.length === 0) return []
      // 델타를 sequence 순서로 이어붙이며 (문자 offset → streamElapsedMs) 색인을 만든다.
      let full = ''
      const marks: { offset: number; ms: number }[] = []
      for (const sequence of sequences) {
        const delta = line.deltas.get(sequence)!
        marks.push({ offset: full.length, ms: delta.streamElapsedMs })
        full += delta.text
      }
      if (!full.trim()) return []
      // offset이 속한 델타의 streamElapsedMs를 찾는다(문장 시작 시각 근사).
      const msAt = (offset: number) => {
        let ms = marks[0].ms
        for (const mark of marks) {
          if (mark.offset <= offset) ms = mark.ms
          else break
        }
        return ms
      }
      const endsFinal = /[.。!?…]["'”’)\]]*\s*$/.test(full)
      const sentences = splitSentences(full)
      // 한 attempt(sttSessionId)를 문장별 라인으로 편다. 마지막 진행중 조각만 pending.
      return sentences.map((sentence, index): CaptionView => {
        const startMs = msAt(sentence.startOffset)
        const isTail = index === sentences.length - 1
        return {
          segmentId: `${line.sttSessionId}#${index}`,
          startMs,
          endMs: startMs,
          // streamElapsedMs는 stream-local이므로 그대로 라벨로 쓴다(세션 상대 ms 변환 금지).
          at: formatTimeLabel(startMs),
          text: sentence.text,
          termReferences: [],
          pending: isTail && !line.completed && !endsFinal,
        }
      })
    })
}
