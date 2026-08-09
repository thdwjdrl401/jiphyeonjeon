import { describe, expect, it } from 'vitest'
import {
  MATERIAL_POLL_INTERVAL_MS,
  hasMaterialInProgress,
  instructorMaterialBadges,
  isMaterialInProgress,
  materialEmbeddingState,
  materialRefetchInterval,
  studentMaterialBadge,
} from '@/features/material/materialStatus'

const pptx = () => new File([''], 'deck.pptx')

describe('materialEmbeddingState', () => {
  it('아직 안 올린 로컬 선택은 서버 상태보다 앞선다', () => {
    // 저장 중 낡은 응답이 섞여도 손에 든 파일이 "준비 완료"로 보이면 안 된다.
    expect(materialEmbeddingState({ file: pptx(), embeddingStatus: 'READY' })).toBe('UPLOAD_PENDING')
  })

  it('서버가 상태를 주지 않으면 READY로 본다', () => {
    // 파이프라인 도입 전 자료이거나 스위치가 꺼진 환경이다. 모르는 걸 "처리 중"으로 치면
    // 폴링이 영원히 돈다 — 아래 refetch 테스트가 그 계약을 함께 고정한다.
    expect(materialEmbeddingState({})).toBe('READY')
  })

  it('레슨 자료의 호환 필드 status도 읽는다', () => {
    expect(materialEmbeddingState({ status: 'PROCESSING' })).toBe('PROCESSING')
    // embeddingStatus가 있으면 그쪽이 이긴다.
    expect(materialEmbeddingState({ status: 'READY', embeddingStatus: 'FAILED' })).toBe('FAILED')
  })
})

describe('isMaterialInProgress', () => {
  it('임베딩이 끝나도 용어 추출이 돌고 있으면 진행 중이다', () => {
    // 두 상태는 직교한다(choinhoo/0010). 한쪽만 보면 폴링이 일찍 멈춘다.
    expect(isMaterialInProgress({ embeddingStatus: 'READY', keyTermStatus: 'PROCESSING' })).toBe(true)
  })

  it('실패는 진행 중이 아니다', () => {
    // FAILED를 진행 중으로 치면 폴링이 영원히 돌고, 화면은 끝나지 않는 작업을 보여 준다.
    expect(isMaterialInProgress({ embeddingStatus: 'FAILED' })).toBe(false)
    expect(isMaterialInProgress({ embeddingStatus: 'READY', keyTermStatus: 'FAILED' })).toBe(false)
  })

  it('요청한 적 없는 용어 추출은 진행 중이 아니다', () => {
    expect(isMaterialInProgress({ embeddingStatus: 'READY', keyTermStatus: 'NOT_REQUESTED' })).toBe(false)
  })
})

describe('materialRefetchInterval', () => {
  it('진행 중인 자료가 있을 때만 폴링한다', () => {
    expect(materialRefetchInterval([{ embeddingStatus: 'PENDING' }])).toBe(MATERIAL_POLL_INTERVAL_MS)
  })

  it('모두 끝나면 스스로 멈춘다', () => {
    // 이 false가 핵심이다 — 화면을 열어 두기만 해도 3초마다 요청이 나가는 상태로 굳지 않게 한다.
    expect(materialRefetchInterval([{ embeddingStatus: 'READY' }, { embeddingStatus: 'FAILED' }])).toBe(false)
  })

  it('자료가 없거나 아직 안 불러왔으면 폴링하지 않는다', () => {
    expect(materialRefetchInterval([])).toBe(false)
    expect(materialRefetchInterval(undefined)).toBe(false)
  })

  it('상태를 모르는 예전 자료만 있으면 폴링하지 않는다', () => {
    expect(materialRefetchInterval([{}, {}])).toBe(false)
  })
})

describe('hasMaterialInProgress', () => {
  it('한 건이라도 걸려 있으면 참이다', () => {
    expect(hasMaterialInProgress([{ embeddingStatus: 'READY' }, { file: pptx() }])).toBe(true)
  })
})

describe('instructorMaterialBadges', () => {
  it('임베딩 배지는 언제나 하나 나온다', () => {
    expect(instructorMaterialBadges({ embeddingStatus: 'READY' }))
      .toEqual([{ label: 'AI 준비 완료', tone: 'success', busy: false }])
  })

  it('요청한 적 없는 용어 추출은 배지를 만들지 않는다', () => {
    // "용어 추출 안 함"은 정보가 아니라 소음이다 — 요청하지 않은 작업의 부재를 알릴 이유가 없다.
    expect(instructorMaterialBadges({ embeddingStatus: 'READY', keyTermStatus: 'NOT_REQUESTED' }))
      .toHaveLength(1)
  })

  it('용어 추출이 돌고 있으면 배지가 하나 더 붙는다', () => {
    const badges = instructorMaterialBadges({ embeddingStatus: 'READY', keyTermStatus: 'PROCESSING' })
    expect(badges.map((badge) => badge.label)).toEqual(['AI 준비 완료', '용어 추출 중'])
  })

  it('강사에게는 실패를 감추지 않는다', () => {
    // 감추면 "왜 AI가 이 자료를 모르지"를 알아낼 방법이 없다.
    const [embedding] = instructorMaterialBadges({ embeddingStatus: 'FAILED' })
    expect(embedding).toEqual({ label: 'AI 준비 실패', tone: 'danger', busy: false })
  })

  it('기다리는 구간에서만 스피너를 돈다', () => {
    expect(instructorMaterialBadges({ embeddingStatus: 'PROCESSING' })[0].busy).toBe(true)
    expect(instructorMaterialBadges({ embeddingStatus: 'PENDING' })[0].busy).toBe(true)
    // 업로드 대기는 사용자가 저장을 눌러야 진행된다 — 기다리면 되는 상태가 아니다.
    expect(instructorMaterialBadges({ file: pptx() })[0].busy).toBe(false)
  })
})

describe('studentMaterialBadge', () => {
  it('준비가 끝나면 아무것도 그리지 않는다', () => {
    expect(studentMaterialBadge({ embeddingStatus: 'READY' })).toBeNull()
  })

  it('PENDING과 PROCESSING을 구분해 보여 주지 않는다', () => {
    // 수강생이 할 수 있는 일은 둘 다 기다리는 것뿐이다. 파이프라인 내부 상태를 노출하지 않는다.
    expect(studentMaterialBadge({ embeddingStatus: 'PENDING' }))
      .toEqual(studentMaterialBadge({ embeddingStatus: 'PROCESSING' }))
  })

  it('실패를 수강생에게 오류로 보여 주지 않는다', () => {
    // 수강생이 고칠 수 있는 게 아니다 — 강사가 손봐야 할 상태로 읽히게 둔다.
    expect(studentMaterialBadge({ embeddingStatus: 'FAILED' }))
      .toEqual({ label: 'AI 준비 안 됨', tone: 'neutral', busy: false })
  })
})
