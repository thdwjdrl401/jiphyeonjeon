import { describe, expect, it } from 'vitest'
import {
  MATERIAL_POLL_INTERVAL_MS,
  hasMaterialInProgress,
  instructorMaterialBadges,
  isMaterialInProgress,
  materialEmbeddingState,
  materialRefetchInterval,
  studentMaterialBadge,
  type MaterialStatusSource,
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
    // 문구 자체보다 "한 개 나온다"가 계약이다. 툴팁 문구까지 묶으면 카피 한 줄에 테스트가 깨진다.
    expect(instructorMaterialBadges({ embeddingStatus: 'READY' })).toHaveLength(1)
    expect(instructorMaterialBadges({ embeddingStatus: 'READY' })[0])
      .toMatchObject({ label: 'AI 반영됨', tone: 'success', busy: false })
  })

  it('요청한 적 없는 용어 추출은 배지를 만들지 않는다', () => {
    // "용어 추출 안 함"은 정보가 아니라 소음이다 — 요청하지 않은 작업의 부재를 알릴 이유가 없다.
    expect(instructorMaterialBadges({ embeddingStatus: 'READY', keyTermStatus: 'NOT_REQUESTED' }))
      .toHaveLength(1)
  })

  it('용어 추출이 돌고 있으면 배지가 하나 더 붙는다', () => {
    const badges = instructorMaterialBadges({ embeddingStatus: 'READY', keyTermStatus: 'PROCESSING' })
    expect(badges.map((badge) => badge.label)).toEqual(['AI 반영됨', '용어 추출'])
  })

  it('강사에게는 실패를 감추지 않는다', () => {
    // 감추면 "왜 AI가 이 자료를 모르지"를 알아낼 방법이 없다.
    const [embedding] = instructorMaterialBadges({ embeddingStatus: 'FAILED' })
    expect(embedding).toMatchObject({ label: '읽기 실패', tone: 'danger' })
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
      .toMatchObject({ label: '미반영', tone: 'neutral', busy: false })
  })
})

describe('배지 문구가 없는 조작을 시키지 않는다', () => {
  it('강사에게 보이는 어떤 배지도 "준비"를 눌러야 할 일처럼 말하지 않는다', () => {
    /*
     * 예전에 "AI 준비" 버튼이 있었고(누르면 501을 던지는 죽은 버튼이었다) 지금은 없다 —
     * 임베딩은 저장과 함께 자동으로 시작한다(ADR-0036). 그 이름이 배지로 돌아오면 강사는
     * 다시 누를 것을 찾는다. 상태는 "무엇이 되는가"로만 말한다.
     */
    const states: MaterialStatusSource[] = [
      { file: new File([''], 'a.pptx') },
      { embeddingStatus: 'PENDING' },
      { embeddingStatus: 'PROCESSING' },
      { embeddingStatus: 'READY' },
      { embeddingStatus: 'FAILED' },
    ]
    for (const material of states) {
      for (const badge of instructorMaterialBadges(material)) {
        expect(badge.label).not.toContain('AI 준비')
      }
    }
  })

  it('수강생 배지도 마찬가지다', () => {
    for (const status of ['PENDING', 'PROCESSING', 'FAILED']) {
      expect(studentMaterialBadge({ embeddingStatus: status })?.label).not.toContain('AI 준비')
    }
  })
})

describe('배지는 좁은 줄에서 버틴다', () => {
  /*
   * 자료 목록의 한 행은 파일명·다운로드·제거 버튼과 자리를 나눠 쓰고, 배지가 두 개 붙기도 한다.
   * 라벨이 길어지면 배지가 줄바꿈되며 행 높이가 늘어 목록 전체가 무너져 보인다. CSS로 배지를
   * 안 줄어들게 고정했지만, 애초에 길지 않아야 그 고정이 파일명을 다 잡아먹지 않는다.
   */
  const ALL: MaterialStatusSource[] = [
    { file: new File([''], 'a.pptx') },
    { embeddingStatus: 'PENDING' },
    { embeddingStatus: 'PROCESSING' },
    { embeddingStatus: 'READY' },
    { embeddingStatus: 'FAILED' },
    { embeddingStatus: 'READY', keyTermStatus: 'PENDING' },
    { embeddingStatus: 'READY', keyTermStatus: 'PROCESSING' },
    { embeddingStatus: 'READY', keyTermStatus: 'READY' },
    { embeddingStatus: 'READY', keyTermStatus: 'EMPTY' },
    { embeddingStatus: 'READY', keyTermStatus: 'FAILED' },
  ]

  it('어떤 배지도 여섯 글자를 넘지 않는다', () => {
    for (const material of ALL) {
      for (const badge of instructorMaterialBadges(material)) {
        expect(badge.label.length, `"${badge.label}"이 너무 길다`).toBeLessThanOrEqual(6)
      }
    }
    for (const status of ['PENDING', 'PROCESSING', 'FAILED']) {
      const badge = studentMaterialBadge({ embeddingStatus: status })
      expect(badge!.label.length, `"${badge!.label}"이 너무 길다`).toBeLessThanOrEqual(6)
    }
  })

  it('짧아진 만큼 뜻은 툴팁이 받는다', () => {
    // 라벨만 줄이고 설명을 없애면 "AI 반영됨"이 무슨 뜻인지 알 길이 사라진다.
    for (const material of ALL) {
      for (const badge of instructorMaterialBadges(material)) {
        expect(badge.title.trim()).not.toBe('')
      }
    }
    expect(studentMaterialBadge({ embeddingStatus: 'PROCESSING' })!.title.trim()).not.toBe('')
  })
})
