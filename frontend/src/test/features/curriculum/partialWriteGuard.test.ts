import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))

import { httpCurriculumManagementService } from '@/features/curriculum/httpCurriculumManagementService'
import { httpLessonService } from '@/features/lesson/httpLessonService'

/**
 * 실패가 확정된 호출은 <b>첫 쓰기 전에</b> 막는다.
 *
 * 자료 연결 API가 아직 없어서, 자료를 포함한 저장은 앞의 쓰기를 모두 보낸 뒤 마지막에서만
 * 404가 났다. 화면엔 "저장 실패"가 뜨는데 서버 데이터는 절반만 바뀌고 롤백할 방법이 없다.
 * 여기서 지키는 것은 "막힐 저장은 아무것도 바꾸지 않는다"는 성질이다.
 */
describe('부분 쓰기 차단', () => {
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

  it('자료가 붙은 커리큘럼 저장은 요청을 하나도 보내지 않고 501로 끝난다', async () => {
    const patch = vi.spyOn(apiClient, 'patch')
    const post = vi.spyOn(apiClient, 'post')
    const put = vi.spyOn(apiClient, 'put')

    await expect(httpCurriculumManagementService.saveCurriculumManagement({
      curriculumId: 'cur-1',
      info: { title: '제목', summary: '요약', description: '설명' },
      sections,
      materials: [{ materialId: 'mat-1', fileName: '자료.pptx', fileSize: 1024 }],
      structureVersion: 3,
    })).rejects.toMatchObject({ status: 501, code: 'API_NOT_IMPLEMENTED' })

    // 커리큘럼 정보·섹션·순서가 이미 바뀐 뒤 실패하면 되돌릴 수 없다.
    expect(patch).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it('자료가 없는 커리큘럼 저장은 그대로 통과하고 없는 자료 경로를 부르지 않는다', async () => {
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: {} } as never)
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} } as never)
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: {} } as never)

    await httpCurriculumManagementService.saveCurriculumManagement({
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
    expect(post).not.toHaveBeenCalled()
  })

  it('새 섹션이 있어도 순서 PUT을 스킵하지 않고, 실제 id·최신 버전으로 전체 순서를 저장한다', async () => {
    vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: {} } as never)
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { sectionId: 'sec-real-9' } } as never)
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { structureVersion: 7 } } as never)
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
    // 저장 결과로 최신 버전 + 임시→실제 id 매핑을 돌려준다
    expect(result).toEqual({ structureVersion: 8, sectionIdMap: { 'sec-new-123': 'sec-real-9' } })
  })

  it('자료가 붙은 레슨 저장은 레슨을 만들기 전에 501로 끝난다', async () => {
    const patch = vi.spyOn(apiClient, 'patch')
    const post = vi.spyOn(apiClient, 'post')

    await expect(httpLessonService.saveLesson({
      sectionId: 'sec-1',
      title: '새 강의',
      description: '설명',
      materials: [new File(['x'], '자료.pptx')],
    })).rejects.toMatchObject({ status: 501, code: 'API_NOT_IMPLEMENTED' })

    expect(post).not.toHaveBeenCalled()
    expect(patch).not.toHaveBeenCalled()
  })

  it('자료가 없는 레슨 저장은 그대로 생성된다', async () => {
    const created = { lessonId: 'les-9', sectionId: 'sec-1', title: '새 강의', description: '설명', status: 'DRAFT' }
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
