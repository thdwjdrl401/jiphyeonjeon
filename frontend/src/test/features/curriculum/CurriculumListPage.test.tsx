import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

const { useCurriculumsMock } = vi.hoisted(() => ({
  useCurriculumsMock: vi.fn(),
}))

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}))

vi.mock('@/features/curriculum/useCurriculums', () => ({
  useCurriculums: useCurriculumsMock,
}))

import CurriculumListPage from '@/pages/CurriculumListPage'

describe('CurriculumListPage', () => {
  it('데스크톱 5열 그리드에 맞춰 한 페이지당 커리큘럼 10개를 조회한다', () => {
    useCurriculumsMock.mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      isFetching: true,
      refetch: vi.fn(),
    })

    const { container } = render(
      <MemoryRouter initialEntries={['/curriculums']}>
        <CurriculumListPage />
      </MemoryRouter>,
    )

    expect(useCurriculumsMock).toHaveBeenCalledWith(
      {
        q: undefined,
        lifecycleStatus: 'PUBLISHED',
        sort: 'LATEST',
        page: 0,
        size: 10,
      },
      undefined,
    )
    expect(container.querySelectorAll('.curriculum-skeleton')).toHaveLength(10)
  })
})
