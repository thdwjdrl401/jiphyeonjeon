import { describe, expect, it } from 'vitest'
import { mergeLectureNote } from '@/features/live-session/lectureNoteMerge'
import type { LectureNoteView } from '@/features/live-session/liveSessionService.interface'

function note(coveredThroughSequence: number, title: string): LectureNoteView {
  return {
    coveredThroughSequence,
    topics: [{ title, keyPoints: [] }],
    markdown: `## ${title}`,
    status: 'CAPTURING',
    updatedAt: null,
  }
}

describe('강의 노트 합치기', () => {
  it('재연결 직후의 옛 조회가 방금 받은 노트를 덮지 않는다', () => {
    const fromSocket = note(21, '최신')
    const fromRead = note(5, '옛것')

    // 재연결 때 유실 보완으로 다시 조회하는데, 그 응답이 뒤처져 있을 수 있다.
    expect(mergeLectureNote(fromSocket, fromRead)).toBe(fromSocket)
  })

  it('끊긴 사이 놓친 갱신은 조회가 채운다', () => {
    const fromSocket = note(5, '끊기기 전')
    const fromRead = note(21, '그동안 자란 것')

    expect(mergeLectureNote(fromSocket, fromRead)).toBe(fromRead)
  })

  it('같은 진행도면 새로고침 전후가 같아야 하므로 어느 쪽이든 내용이 같다', () => {
    const merged = mergeLectureNote(note(21, '같은 것'), note(21, '같은 것'))
    expect(merged?.coveredThroughSequence).toBe(21)
  })

  it('한쪽만 있으면 그것을 쓴다', () => {
    const only = note(3, '하나뿐')
    expect(mergeLectureNote(only, null)).toBe(only)
    expect(mergeLectureNote(null, only)).toBe(only)
    expect(mergeLectureNote(null, undefined)).toBeNull()
  })
})
