import type { CaptionTermReference, CaptionView } from './liveSessionService.interface'

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
