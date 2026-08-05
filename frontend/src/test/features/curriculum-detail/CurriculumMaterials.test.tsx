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

  it('자료가 없어도 카드를 보여주고 모달에서 없음을 안내한다', async () => {
    const user = userEvent.setup()
    render(<CurriculumMaterials materials={[]} />)

    expect(screen.getByRole('heading', { name: '커리큘럼 강의 자료' })).toBeInTheDocument()
    expect(screen.getByText('아직 등록된 강의 자료가 없습니다.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '자료 목록' }))

    const dialog = screen.getByRole('dialog', { name: '커리큘럼 강의 자료' })
    expect(
      within(dialog).getByText('등록된 강의 자료가 없습니다. 자료가 등록되면 이곳에서 확인할 수 있습니다.'),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('list')).not.toBeInTheDocument()
  })

  it('downloadHref를 주면 자료마다 다운로드 링크를 붙인다', async () => {
    const user = userEvent.setup()
    render(
      <CurriculumMaterials
        materials={materials}
        downloadHref={(material) => `/api/curriculums/cur-1/materials/${material.materialId}/download`}
      />,
    )

    await user.click(screen.getByRole('button', { name: '자료 목록' }))

    const dialog = screen.getByRole('dialog', { name: '커리큘럼 강의 자료' })
    const firstLink = within(dialog).getByRole('link', { name: '공통 실습 환경 설정.pptx 다운로드' })
    expect(firstLink).toHaveAttribute('href', '/api/curriculums/cur-1/materials/material-1/download')
    // presigned URL에는 원본 파일명이 없다 — 저장될 이름을 링크가 들고 있어야 한다.
    expect(firstLink).toHaveAttribute('download', '공통 실습 환경 설정.pptx')
    expect(
      within(dialog).getByRole('link', { name: 'Spring Boot 커리큘럼 가이드.pptx 다운로드' }),
    ).toHaveAttribute('href', '/api/curriculums/cur-1/materials/material-2/download')
  })

  it('downloadHref가 없으면 다운로드 링크를 붙이지 않는다', async () => {
    const user = userEvent.setup()
    render(<CurriculumMaterials materials={materials} />)

    await user.click(screen.getByRole('button', { name: '자료 목록' }))

    const dialog = screen.getByRole('dialog', { name: '커리큘럼 강의 자료' })
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument()
  })
})
