import { describe, expect, it } from 'vitest'
import { describeReplayInvitation } from '@/features/live-session/liveEnded'

/**
 * 다 본 학생에게 무엇을 권하는가.
 *
 * <p>이 판단이 걸리는 시점은 <b>재생 완료</b>이지 세션 종료가 아니다(ADR-0005 §3) — 그 구분은
 * 화면 쪽(`PlaybackPlayer`의 `ended` 상태)이 지킨다. 여기서는 다시보기 상태별 문구·행동만 본다.
 */
describe('describeReplayInvitation', () => {
  it('공개된 다시보기는 바로 열 수 있다', () => {
    expect(describeReplayInvitation('PUBLISHED')).toEqual({
      message: '다시보기로 처음부터 다시 볼 수 있습니다.',
      canOpen: true,
    })
  })

  it('아직 준비 중이면 링크를 걸지 않는다', () => {
    // 눌러 봐야 빈 화면이다. 공개는 자동이므로(ADR-0090) 학생이 할 일은 없다.
    const invitation = describeReplayInvitation('NOT_READY')
    expect(invitation.canOpen).toBe(false)
    expect(invitation.message).toContain('준비하고 있어요')
  })

  it('NOT_READY와 DRAFT를 구분해 보여 주지 않는다', () => {
    // 학생이 할 수 있는 일이 같다. DRAFT는 대개 녹화 실패인데 알려 봐야 손쓸 방법이 없다.
    expect(describeReplayInvitation('DRAFT')).toEqual(describeReplayInvitation('NOT_READY'))
  })

  it('내려진 다시보기를 "준비 중"이라고 하지 않는다', () => {
    // 오지 않을 것을 기다리게 만들면 안 된다.
    const invitation = describeReplayInvitation('WITHDRAWN')
    expect(invitation.canOpen).toBe(false)
    expect(invitation.message).not.toContain('준비')
  })

  it('어떤 상태에서도 학생에게 조작을 시키지 않는다', () => {
    // 다시보기 공개는 자동이다. "요청하세요"·"문의하세요" 같은 말이 끼면 없는 절차를 만든다.
    for (const status of ['NOT_READY', 'DRAFT', 'PUBLISHED', 'WITHDRAWN'] as const) {
      const { message } = describeReplayInvitation(status)
      expect(message).not.toMatch(/요청|문의|새로고침/)
    }
  })
})
