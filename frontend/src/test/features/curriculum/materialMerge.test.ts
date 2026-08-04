import { describe, expect, it } from 'vitest'
import { mergeCurriculumMaterials } from '@/features/curriculum/materialMerge'
import type { CurriculumMaterial } from '@/features/curriculum/types'

function pending(fileName: string, fileSize: number): CurriculumMaterial {
  return {
    materialId: `curriculum-material-${fileName}`,
    fileName,
    fileSize,
    file: new File(['x'], fileName, { type: 'application/octet-stream' }),
  }
}

function persistedMaterial(materialId: string, fileName: string, fileSize: number): CurriculumMaterial {
  return { materialId, fileName, fileSize }
}

/**
 * 저장 응답으로 로컬 목록을 통째로 덮던 자리를 대체한다(ADR-0077). 덮으면 저장 중 고른 파일이 사라지고,
 * 부분 실패 후에는 이미 붙은 자료가 대기로 남아 다음 저장에서 지워지고 다시 올라갔다.
 */
describe('mergeCurriculumMaterials', () => {
  it('서버 목록을 진실로 삼고, 이미 붙은 자료는 대기 상태로 남기지 않는다', () => {
    const local = [pending('a.pptx', 100), pending('b.pptx', 200)]
    const persisted = [persistedMaterial('mat-1', 'a.pptx', 100), persistedMaterial('mat-2', 'b.pptx', 200)]

    const merged = mergeCurriculumMaterials(persisted, local)

    expect(merged).toEqual(persisted)
    expect(merged.some((material) => material.file)).toBe(false)
  })

  it('아직 서버에 없는 선택(저장 중에 고른 파일)은 대기로 남긴다', () => {
    const local = [pending('a.pptx', 100), pending('c.pptx', 300)]
    const persisted = [persistedMaterial('mat-1', 'a.pptx', 100)]

    const merged = mergeCurriculumMaterials(persisted, local)

    expect(merged.map((material) => material.fileName)).toEqual(['a.pptx', 'c.pptx'])
    expect(merged[0].file).toBeUndefined()
    expect(merged[1].file).toBeInstanceOf(File)
  })

  it('부분 실패에서 붙은 것만 정리하고 실패한 파일은 재시도 대상으로 남긴다', () => {
    const local = [pending('ok.pptx', 100), pending('failed.pptx', 200)]
    // ok.pptx만 서버에 붙은 상태에서 두 번째가 실패했다.
    const persisted = [persistedMaterial('mat-1', 'ok.pptx', 100)]

    const merged = mergeCurriculumMaterials(persisted, local)

    expect(merged).toHaveLength(2)
    expect(merged.filter((material) => material.file).map((material) => material.fileName)).toEqual(['failed.pptx'])
  })

  it('로컬에서 지웠지만 서버에 남은 자료는 서버 상태를 따른다', () => {
    const merged = mergeCurriculumMaterials([persistedMaterial('mat-1', 'kept.pptx', 100)], [])

    expect(merged.map((material) => material.materialId)).toEqual(['mat-1'])
  })

  it('같은 이름·다른 크기는 다른 자료로 본다', () => {
    const local = [pending('report.pptx', 999)]
    const persisted = [persistedMaterial('mat-1', 'report.pptx', 100)]

    const merged = mergeCurriculumMaterials(persisted, local)

    expect(merged).toHaveLength(2)
    expect(merged[1].file).toBeInstanceOf(File)
  })
})
