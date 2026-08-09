import type { CurriculumReplayStatus } from '@/features/lesson/types'

/**
 * 다 본 학생에게 무엇을 권할지.
 *
 * <p>이 판단이 걸리는 시점은 <b>재생 완료</b>이지 세션 종료가 아니다(ADR-0005 §3). 강사가 송출을
 * 끝내도 학생에게는 인코딩·버퍼 지연만큼 볼 것이 남아 있다.
 *
 * <p>다시보기 공개는 자동이라(ADR-0090) 대개 곧 열린다 — "기다려 주세요"가 아니라 "준비하고
 * 있어요"라고 쓰는 이유다. 학생이 할 일은 없다.
 */
export interface ReplayInvitation {
  message: string
  /** 지금 다시보기로 갈 수 있는가. false면 링크를 걸지 않는다 — 눌러 봐야 빈 화면이다. */
  canOpen: boolean
}

export function describeReplayInvitation(replayStatus: CurriculumReplayStatus): ReplayInvitation {
  switch (replayStatus) {
    case 'PUBLISHED':
      return { message: '다시보기로 처음부터 다시 볼 수 있습니다.', canOpen: true }
    case 'WITHDRAWN':
      // 강사가 내린 것이다. 준비 중이라고 하면 오지 않을 것을 기다리게 된다.
      return { message: '이 강의는 다시보기가 공개되지 않았습니다.', canOpen: false }
    default:
      /*
       * NOT_READY·DRAFT. 둘을 구분해 보여 주지 않는다 — 학생이 할 수 있는 일이 같고, DRAFT는
       * 대개 녹화가 실패한 자산이라 그 사실을 학생에게 알려 봐야 손쓸 방법이 없다. 강사에게는
       * 강의 상세의 처리 배지가 따로 말해 준다.
       */
      return { message: '다시보기를 준비하고 있어요. 준비되면 여기에서 바로 열 수 있습니다.', canOpen: false }
  }
}
