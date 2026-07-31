import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import CurriculumMaterials from '@/features/curriculum/CurriculumMaterials'

const materials = [
  { materialId: 'material-1', fileName: '공통 실습 환경 설정.pptx', fileSize: 34 * 1024 },
  { materialId: 'material-2', fileName: 'Spring Boot 커리큘럼 가이드.pptx', fileSize: 2 * 1024 * 1024 },
]

describe('CurriculumMaterials', () => {
  it('카드에서는 목록을 숨기고 버튼으로 모달을 열고 닫는다', async () => {
    const user = userEvent.setup()
    render(<CurriculumMaterials materials={materials} />)

    const trigger = screen.getByRole('button', { name: '자료 목록' })
    expect(screen.queryByText('공통 실습 환경 설정.pptx')).not.toBeInTheDocument()

    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '커리큘럼 강의 자료' })
    expect(within(dialog).getByText('공통 실습 환경 설정.pptx')).toBeInTheDocument()
    expect(within(dialog).getByText('Spring Boot 커리큘럼 가이드.pptx')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '강의 자료 목록 닫기' })).toHaveFocus()
    expect(document.body).toHaveStyle({ overflow: 'hidden' })

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body).not.toHaveStyle({ overflow: 'hidden' })
  })
})
