import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))

import { publishLesson, unpublishLesson } from '@/features/lesson/lessonService'

const lessonView = {
  lessonId: 'les-1',
  sectionId: 'sec-1',
  title: '레슨',
  description: '설명',
  status: 'PUBLISHED',
}

describe('lesson 게시/게시취소 HTTP 서비스 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('게시는 publish API를 호출하고 새 상태를 반환한다', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: lessonView } as never)

    await expect(publishLesson('les-1')).resolves.toEqual({ lessonId: 'les-1', status: 'PUBLISHED' })
    expect(postSpy).toHaveBeenCalledWith('/instructor/lessons/les-1/publish')
  })

  it('게시취소는 unpublish API를 호출하고 DRAFT 상태를 반환한다', async () => {
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { ...lessonView, status: 'DRAFT' },
    } as never)

    await expect(unpublishLesson('les-1')).resolves.toEqual({ lessonId: 'les-1', status: 'DRAFT' })
    expect(postSpy).toHaveBeenCalledWith('/instructor/lessons/les-1/unpublish')
  })
})
