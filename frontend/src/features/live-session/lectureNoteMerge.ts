import type { LectureNoteView } from './liveSessionService.interface'

/**
 * 조회로 받은 노트와 WebSocket으로 받은 노트를 합친다.
 *
 * <p>둘은 같은 것의 다른 도착 경로다 — 서버가 늘 "현재 전체"를 주므로 이어 붙일 필요가 없고,
 * <b>더 멀리 간 쪽</b>만 고르면 된다.
 *
 * <p>이 판정이 필요한 이유는 재연결 때다. 재연결 직후 다시 조회하는데(유실 보완), 그 응답이
 * 방금 WebSocket으로 받은 것보다 오래된 것일 수 있다. 그대로 쓰면 화면이 뒤로 간다.
 */
export function mergeLectureNote(
  fromSocket: LectureNoteView | null,
  fromRead: LectureNoteView | null | undefined,
): LectureNoteView | null {
  if (!fromSocket) return fromRead ?? null
  if (!fromRead) return fromSocket
  return fromSocket.coveredThroughSequence >= fromRead.coveredThroughSequence ? fromSocket : fromRead
}
