import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import type { AuthUser } from '@/features/auth/types'
import WorkspaceSidebar from '@/shared/layout/WorkspaceSidebar'

const users: ReadonlyArray<{
  user: AuthUser
  curriculumPath: string
  profilePath: string
  notificationsPath: string
  curriculumLabel: string
}> = [
  {
    user: {
      userId: 'instructor-1',
      email: 'instructor@example.com',
      displayName: '김강사',
      role: 'INSTRUCTOR',
      profileImageUrl: null,
      isAdmin: false,
    },
    curriculumPath: '/instructor/curriculums',
    profilePath: '/instructor/profile',
    notificationsPath: '/instructor/notifications',
    curriculumLabel: '커리큘럼 관리',
  },
  {
    user: {
      userId: 'student-1',
      email: 'student@example.com',
      displayName: '이학생',
      role: 'STUDENT',
      profileImageUrl: null,
      isAdmin: false,
    },
    curriculumPath: '/student/curriculums',
    profilePath: '/student/profile',
    notificationsPath: '/student/notifications',
    curriculumLabel: '내 커리큘럼',
  },
]

describe('WorkspaceSidebar', () => {
  it.each(users)('$user.role 역할의 공통 작업 메뉴를 표시한다', ({
    user,
    curriculumPath,
    profilePath,
    notificationsPath,
    curriculumLabel,
  }) => {
    render(
      <MemoryRouter>
        <WorkspaceSidebar user={user} />
      </MemoryRouter>,
    )

    const sidebar = screen.getByRole('complementary', { name: '작업 메뉴' })
    expect(within(sidebar).getByText(user.displayName)).toBeInTheDocument()
    expect(within(sidebar).getByRole('link', { name: curriculumLabel })).toHaveAttribute('href', curriculumPath)
    expect(within(sidebar).getByRole('link', { name: '내 프로필' })).toHaveAttribute('href', profilePath)
    expect(within(sidebar).getByRole('link', { name: '전체 알림' })).toHaveAttribute('href', notificationsPath)
  })
})
