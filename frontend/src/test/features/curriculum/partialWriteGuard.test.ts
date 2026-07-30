import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))
// 자료 업로드(presigned)는 스토리지로 직접 나가는 axios 호출을 포함한다 — 계약 테스트에서는
// uploadAsset을 대체해 attach 호출(Method·URL·assetId)만 검증한다.
vi.mock('@/shared/api/uploadAsset', () => ({
  uploadAsset: vi.fn(async () => ({ assetId: 'asset-9', kind: 'MATERIAL', status: 'UPLOADED' })),
}))

import { httpCurriculumManagementService } from '@/features/curriculum/httpCurriculumManagementService'
import { httpLessonService } from '@/features/lesson/httpLessonService'

/**
 * 커리큘럼 저장 계약(ADR-0042 이후). 자료 연결 API가 생겨 501 가드는 사라졌고, 저장은 구조를 먼저
 * 반영한 뒤 자료를 동기화한다 — 새로 선택한(File 보유) 자료는 업로드→attach, 사라진 persisted 자료는 삭제.
 */
describe('커리큘럼 저장 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const sections = [{
    sectionId: 'sec-1',
    title: '1주차',
    description: '설명',
    order: 1,
    lessons: [{ lessonId: 'les-1', title: '1강', status: 'PUBLISHED' }],
  }]

  it('자료가 없는 커리큘럼 저장은 정보·순서만 쓰고 자료 연결/삭제 경로를 부르지 않는다', async () => {
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: {} } as never)
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} } as never)
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: { structureVersion: 4 } } as never)
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { materials: [] } } as never)
    const del = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: {} } as never)

    const result = await httpCurriculumManagementService.saveCurriculumManagement({
      curriculumId: 'cur-1',
      info: { title: '제목', summary: '요약', description: '설명' },
      sections,
      materials: [],
      structureVersion: 3,
    })

    expect(patch).toHaveBeenCalledWith('/instructor/curriculums/cur-1', {
      title: '제목', summary: '요약', description: '설명',
    })
    expect(put).toHaveBeenCalledWith('/instructor/curriculums/cur-1/curriculum/order', {
      baseVersion: 3,
      sections: [{ sectionId: 'sec-1', lessonIds: ['les-1'] }],
    })
    expect(put).toHaveBeenCalledTimes(1)
    // 새 섹션 없음 + 새 자료 없음 → POST는 아무 것도 부르지 않는다. 삭제할 자료도 없다.
    expect(post).not.toHaveBeenCalled()
    expect(del).not.toHaveBeenCalled()
    expect(result.materials).toEqual([])
  })

  it('새로 선택한 자료는 업로드→attach로 연결된다', async () => {
    vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: {} } as never)
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} } as never)
    vi.spyOn(apiClient, 'put').mockResolvedValue({ data: { structureVersion: 4 } } as never)
    // 저장 전 서버 자료는 비어 있음 → 삭제할 것 없음.
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { materials: [] } } as never)
    const del = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: {} } as never)

    const file = new File(['deck'], '자료.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
    await httpCurriculumManagementService.saveCurriculumManagement({
      curriculumId: 'cur-1',
      info: { title: '제목', summary: '요약', description: '설명' },
      sections,
      materials: [{ materialId: 'tmp-1', fileName: '자료.pptx', fileSize: file.size, file }],
      structureVersion: 3,
    })

    expect(post).toHaveBeenCalledWith('/instructor/curriculums/cur-1/materials', { assetId: 'asset-9' })
    expect(del).not.toHaveBeenCalled()
  })

  it('사라진 persisted 자료는 삭제하고, 유지한 자료는 건드리지 않는다', async () => {
    vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: {} } as never)
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} } as never)
    vi.spyOn(apiClient, 'put').mockResolvedValue({ data: { structureVersion: 4 } } as never)
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: { materials: [
        { materialId: 'mat-1', fileName: 'keep.pptx', fileSize: 10 },
        { materialId: 'mat-2', fileName: 'drop.pptx', fileSize: 20 },
      ] },
    } as never)
    const del = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: {} } as never)

    await httpCurriculumManagementService.saveCurriculumManagement({
      curriculumId: 'cur-1',
      info: { title: '제목', summary: '요약', description: '설명' },
      sections,
      // mat-1만 남기고 mat-2를 뺀다(둘 다 persisted — file 없음).
      materials: [{ materialId: 'mat-1', fileName: 'keep.pptx', fileSize: 10 }],
      structureVersion: 3,
    })

    expect(del).toHaveBeenCalledWith('/instructor/curriculums/cur-1/materials/mat-2')
    expect(del).toHaveBeenCalledTimes(1)
    // 새로 올린 자료가 없으니 자료 attach(POST /materials)는 없다.
    expect(post).not.toHaveBeenCalledWith('/instructor/curriculums/cur-1/materials', expect.anything())
  })

  it('새 섹션이 있어도 순서 PUT을 스킵하지 않고, 실제 id·최신 버전으로 전체 순서를 저장한다', async () => {
    vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: {} } as never)
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { sectionId: 'sec-real-9' } } as never)
    // 새 섹션 생성 후 structureVersion 재조회 + 자료 baseline/final 조회 모두 이 목을 탄다.
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { structureVersion: 7, materials: [] } } as never)
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: { structureVersion: 8 } } as never)

    const result = await httpCurriculumManagementService.saveCurriculumManagement({
      curriculumId: 'cur-1',
      info: { title: '제목', summary: '요약', description: '설명' },
      sections: [
        { sectionId: 'sec-new-123', title: '새 섹션', description: '', order: 1, lessons: [] },
        ...sections,
      ],
      materials: [],
      structureVersion: 3,
    })

    // 새 섹션을 먼저 만들고
    expect(post).toHaveBeenCalledWith('/instructor/curriculums/cur-1/sections', { title: '새 섹션', description: '' })
    // 생성으로 버전이 올랐으므로 최신 버전을 다시 읽어 baseVersion(7)으로, 새 섹션은 실제 id로 담아 순서 저장
    expect(get).toHaveBeenCalledWith('/instructor/curriculums/cur-1')
    expect(put).toHaveBeenCalledWith('/instructor/curriculums/cur-1/curriculum/order', {
      baseVersion: 7,
      sections: [
        { sectionId: 'sec-real-9', lessonIds: [] },
        { sectionId: 'sec-1', lessonIds: ['les-1'] },
      ],
    })
    // 저장 결과로 최신 버전 + 임시→실제 id 매핑 + 저장된 자료 목록을 돌려준다
    expect(result).toEqual({ structureVersion: 8, sectionIdMap: { 'sec-new-123': 'sec-real-9' }, materials: [] })
  })

  it('자료가 없는 레슨 저장은 그대로 생성된다', async () => {
    const created = { lessonId: 'les-9', sectionId: 'sec-1', title: '새 강의', description: '설명', status: 'PUBLISHED' }
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: created } as never)

    await expect(httpLessonService.saveLesson({
      sectionId: 'sec-1',
      title: '새 강의',
      description: '설명',
      materials: [],
    })).resolves.toEqual(created)

    expect(post).toHaveBeenCalledWith('/instructor/sections/sec-1/lessons', {
      title: '새 강의', description: '설명',
    })
    expect(post).toHaveBeenCalledTimes(1)
  })
})
