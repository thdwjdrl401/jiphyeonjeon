import { describe, expect, it } from 'vitest'
import {
  materialUploadLabel,
  recordedUploadLabel,
} from '@/features/material/uploadProgressLabel'

describe('recordedUploadLabel', () => {
  it('단계 이름을 그대로 보여 주지 않는다', () => {
    // REQUESTING_PROCESSING은 강사에게 아무 뜻도 아니다.
    const label = recordedUploadLabel({ stage: 'REQUESTING_PROCESSING', ratio: null })
    expect(label).not.toMatch(/[A-Z_]{4,}/)
    expect(label).toBe('영상 처리를 요청하는 중…')
  })

  it('자료가 한 개면 (1/1)을 붙이지 않는다', () => {
    // 세는 척만 하는 소음이다.
    expect(recordedUploadLabel({
      stage: 'UPLOADING_MATERIALS', ratio: 0.5, materialIndex: 1, materialCount: 1, fileName: 'deck.pptx',
    })).toBe('강의 자료 업로드 중 · deck.pptx')
  })

  it('자료가 여럿이면 몇 번째인지 붙인다', () => {
    expect(recordedUploadLabel({
      stage: 'UPLOADING_MATERIALS', ratio: 0.5, materialIndex: 2, materialCount: 3, fileName: 'b.pptx',
    })).toBe('강의 자료 업로드 중 (2/3) · b.pptx')
  })

  it('영상 단계는 파일 이름 없이도 말이 된다', () => {
    expect(recordedUploadLabel({ stage: 'UPLOADING_VIDEO', ratio: 0.1 })).toBe('영상 업로드 중…')
  })

  it('모든 단계가 빈 문자열이 아닌 라벨을 낸다', () => {
    // 라벨이 비면 진행 막대만 남아 무슨 일이 일어나는지 알 수 없다.
    const stages = ['CREATING_LESSON', 'UPLOADING_MATERIALS', 'UPLOADING_VIDEO', 'REQUESTING_PROCESSING'] as const
    for (const stage of stages) {
      expect(recordedUploadLabel({ stage, ratio: null }).trim()).not.toBe('')
    }
  })
})

describe('materialUploadLabel', () => {
  it('한 개일 때는 개수를 세지 않는다', () => {
    expect(materialUploadLabel({ index: 1, count: 1, fileName: 'a.pptx', ratio: 0 }))
      .toBe('강의 자료 업로드 중 · a.pptx')
  })

  it('여럿일 때는 몇 번째인지 붙인다', () => {
    expect(materialUploadLabel({ index: 3, count: 4, fileName: 'c.pptx', ratio: 0 }))
      .toBe('강의 자료 업로드 중 (3/4) · c.pptx')
  })
})
