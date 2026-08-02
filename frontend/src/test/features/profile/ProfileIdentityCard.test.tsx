import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '@/features/auth/types'
import ProfileIdentityCard from '@/features/profile/ProfileIdentityCard'

/**
 * 통합 프로필 카드가 지켜야 할 것들.
 *
 * 예전에는 "계정 정보"·"기본 프로필" 두 패널로 갈라져 **이메일이 두 번** 나왔다. 다시 갈라지거나
 * 이메일이 중복되면 화면만 봐서는 "정보가 좀 많네" 정도로 보여 놓치기 쉬우므로 여기서 못 박는다.
 *
 * 가입 유형·이메일이 **읽기 전용**이라는 것도 함께 고정한다 — 입력 필드로 바뀌면 고칠 수 없는
 * 값을 고칠 수 있는 것처럼 보여 준다.
 */

const student: AuthUser = {
  userId: 'usr-1',
  email: 'student01@example.com',
  displayName: '김학생',
  role: 'STUDENT',
  profileImageUrl: null,
  isAdmin: false,
}

const instructor: AuthUser = {
  userId: 'usr-2',
  email: 'instructor@liveclass.ai',
  displayName: '박강사',
  role: 'INSTRUCTOR',
  profileImageUrl: 'https://cdn.example.com/avatar.png',
  isAdmin: false,
}

function renderCard(user: AuthUser, onEdit = vi.fn()) {
  const view = render(<ProfileIdentityCard user={user} onEdit={onEdit} />)
  return { ...view, onEdit }
}

describe('통합 프로필 카드', () => {
  it.each([
    ['학생', student, '학생'],
    ['강사', instructor, '강사'],
  ])('%s 계정의 이름·가입 유형·이메일을 한 카드에서 보여 준다', (_label, user, roleLabel) => {
    renderCard(user)

    const card = screen.getByRole('region', { name: user.displayName })
    expect(within(card).getByRole('heading', { name: user.displayName })).toBeInTheDocument()
    expect(within(card).getByText(roleLabel)).toBeInTheDocument()
    expect(within(card).getByText(user.email)).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: '프로필 수정' })).toBeInTheDocument()
  })

  it('이메일을 한 번만 표시한다', () => {
    renderCard(student)

    // 두 카드로 갈라져 있던 구조로 되돌아가면 여기서 2개가 잡힌다.
    expect(screen.getAllByText(student.email)).toHaveLength(1)
  })

  it('가입 유형과 이메일은 레이블이 있는 읽기 전용 정보다', () => {
    renderCard(instructor)

    // 스크린리더가 값만 읽고 "무슨 값인지" 모르면 안 된다 — dt로 이름을 붙인다.
    const roleTerm = screen.getByText('가입 유형')
    const emailTerm = screen.getByText('가입 이메일')
    expect(roleTerm.tagName).toBe('DT')
    expect(emailTerm.tagName).toBe('DT')
    expect(roleTerm.nextElementSibling).toHaveTextContent('강사')
    expect(emailTerm.nextElementSibling).toHaveTextContent(instructor.email)

    // 수정 가능한 것은 이미지와 닉네임뿐이고, 그 둘은 "프로필 수정"으로만 들어간다.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('색만으로 학생·강사를 구분하지 않는다', () => {
    const { unmount } = renderCard(student)
    // 배지 안에 글자가 들어 있어야 색을 못 보는 환경에서도 구분된다.
    expect(screen.getByText('학생')).toBeInTheDocument()
    unmount()

    renderCard(instructor)
    expect(screen.getByText('강사')).toBeInTheDocument()
  })

  it('프로필 이미지가 없으면 이름 첫 글자로 대체한다', () => {
    renderCard(student)

    const avatar = screen.getByRole('img', { name: '김학생 프로필 이미지' })
    expect(avatar).toHaveTextContent('김')
    expect(avatar.querySelector('img')).toBeNull()
  })

  it('프로필 이미지가 있으면 이미지를 대체 텍스트와 함께 보여 준다', () => {
    renderCard(instructor)

    const avatar = screen.getByRole('img', { name: '박강사 프로필 이미지' })
    expect(avatar.querySelector('img')).toHaveAttribute('src', instructor.profileImageUrl)
  })

  it('긴 닉네임과 긴 이메일도 잘라내지 않고 그대로 담는다', () => {
    const longUser: AuthUser = {
      ...student,
      displayName: '아주아주기이이인닉네임을가진사용자입니다반복반복반복반복',
      email: 'very.long.email.address.for.layout.check@extremely-long-domain-example.co.kr',
    }
    renderCard(longUser)

    // 말줄임으로 감추면 확인해야 할 계정을 읽을 수 없다 — 텍스트가 온전히 남아야 한다.
    expect(screen.getByRole('heading', { name: longUser.displayName })).toBeInTheDocument()
    expect(screen.getByText(longUser.email)).toBeInTheDocument()
  })

  it('프로필 수정 버튼이 기존 수정 흐름을 연다', async () => {
    const user = userEvent.setup()
    const { onEdit } = renderCard(student)

    await user.click(screen.getByRole('button', { name: '프로필 수정' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
  })
})
