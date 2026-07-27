import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))

import { deleteLesson, deleteSection } from '@/features/curriculum/curriculumManagementService'

describe('커리큘럼 구조 삭제 HTTP 서비스 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('강의 삭제는 lesson DELETE API를 호출한다', async () => {
    const deleteSpy = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: undefined } as never)

    await deleteLesson('les-1')

    expect(deleteSpy).toHaveBeenCalledWith('/instructor/lessons/les-1')
  })

  it('섹션 삭제는 section DELETE API를 호출한다', async () => {
    const deleteSpy = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: undefined } as never)

    await deleteSection('sec-1')

    expect(deleteSpy).toHaveBeenCalledWith('/instructor/sections/sec-1')
  })
})
