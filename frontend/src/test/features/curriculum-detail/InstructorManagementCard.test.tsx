import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import InstructorManagementCard from '@/features/curriculum-detail/InstructorManagementCard'

describe('InstructorManagementCard', () => {
  it('담당 강사에게 관리 안내와 관리하기 버튼을 보여준다', async () => {
    const user = userEvent.setup()
    const onManage = vi.fn()
    render(<InstructorManagementCard isInstructor onManage={onManage} />)

    expect(screen.getByRole('heading', { name: '담당 강사 관리' })).toBeInTheDocument()
    expect(screen.getByText('이 커리큘럼을 관리하고 강의를 편성할 수 있어요.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '관리하기' }))
    expect(onManage).toHaveBeenCalledTimes(1)
  })

  it('담당 강사가 아니면 안내만 보여주고 버튼은 렌더링하지 않는다', () => {
    const onManage = vi.fn()
    render(<InstructorManagementCard isInstructor={false} onManage={onManage} />)

    expect(screen.getByRole('heading', { name: '다른 강사가 운영하는 커리큘럼이에요' })).toBeInTheDocument()
    expect(screen.getByText('이 커리큘럼은 강사 계정으로 수강할 수 없어요.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(onManage).not.toHaveBeenCalled()
  })
})
