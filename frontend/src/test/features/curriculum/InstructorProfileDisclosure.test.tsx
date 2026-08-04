import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import InstructorProfileDisclosure from '@/features/curriculum/InstructorProfileDisclosure'
import type { CurriculumInstructorProfile } from '@/features/curriculum/types'

const instructor: CurriculumInstructorProfile = {
  instructorId: 'usr-instructor-01',
  displayName: '이도현',
  bio: '10년간 대규모 트래픽 백엔드를 설계해온 백엔드 엔지니어입니다.',
  expertise: ['Spring', 'JPA'],
}

const toggle = () => screen.getByRole('button', { name: '이도현 강사 정보' })

describe('InstructorProfileDisclosure', () => {
  it('처음에는 강사 이름만 보이고 상세 정보는 접혀 있다', () => {
    render(<InstructorProfileDisclosure instructor={instructor} />)

    expect(screen.getByText('이도현')).toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(instructor.bio)).not.toBeVisible()
  })

  it('버튼을 누르면 소개와 전문 분야를 펼치고 다시 누르면 접는다', async () => {
    const user = userEvent.setup()
    render(<InstructorProfileDisclosure instructor={instructor} />)

    await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('heading', { name: '강사 소개' })).toBeVisible()
    expect(screen.getByText(instructor.bio)).toBeVisible()
    expect(screen.getByRole('heading', { name: '전문 분야' })).toBeVisible()
    expect(screen.getByText('Spring')).toBeVisible()
    expect(screen.getByText('JPA')).toBeVisible()

    await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(instructor.bio)).not.toBeVisible()
  })

  it('Escape를 누르면 닫고 포커스를 버튼으로 돌려준다', async () => {
    const user = userEvent.setup()
    render(<InstructorProfileDisclosure instructor={instructor} />)

    await user.click(toggle())
    await user.keyboard('{Escape}')

    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
    expect(toggle()).toHaveFocus()
  })

  it('바깥을 클릭하면 닫는다', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <InstructorProfileDisclosure instructor={instructor} />
        <button type="button">바깥</button>
      </div>,
    )

    await user.click(toggle())
    await user.click(screen.getByRole('button', { name: '바깥' }))

    expect(toggle()).toHaveAttribute('aria-expanded', 'false')
  })

  it('한 항목에 쉼표로 묶여 온 전문 분야를 태그로 나눠 보여준다', async () => {
    const user = userEvent.setup()
    render(
      <InstructorProfileDisclosure
        instructor={{ ...instructor, expertise: ['Spring, JPA', ' 분산 시스템 ', 'Spring'] }}
      />,
    )

    await user.click(toggle())

    const tags = screen.getAllByRole('listitem').map((item) => item.textContent)
    expect(tags).toEqual(['Spring', 'JPA', '분산 시스템'])
  })

  it('소개의 줄바꿈을 살려서 한 문단으로 뭉치지 않는다', async () => {
    const user = userEvent.setup()
    render(<InstructorProfileDisclosure instructor={{ ...instructor, bio: '첫 줄\n둘째 줄' }} />)

    await user.click(toggle())

    expect(screen.getByText(/첫 줄/).textContent).toBe('첫 줄\n둘째 줄')
  })

  it('소개도 전문 분야도 없으면 토글 없이 이름만 보여준다', () => {
    render(<InstructorProfileDisclosure instructor={{ ...instructor, bio: '  ', expertise: [] }} />)

    expect(screen.getByText('이도현')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
