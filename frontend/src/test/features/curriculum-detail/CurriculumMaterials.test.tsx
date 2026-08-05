import type { ReactElement } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CurriculumMaterials from '@/features/curriculum/CurriculumMaterials'
import type { CurriculumMaterial } from '@/features/curriculum/types'
import * as materialDownloadService from '@/features/material/materialDownloadService'
import { ApiError } from '@/shared/api/client'
import { ToastProvider } from '@/shared/ui/Toast'

const materials = [
  { materialId: 'material-1', fileName: '공통 실습 환경 설정.pptx', fileSize: 34 * 1024 },
  { materialId: 'material-2', fileName: 'Spring Boot 커리큘럼 가이드.pptx', fileSize: 2 * 1024 * 1024 },
]

const downloadRequest = (material: CurriculumMaterial) => ({
  scope: 'CURRICULUM' as const,
  parentId: 'cur-1',
  materialId: material.materialId,
  fileName: material.fileName,
})

function renderMaterials(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>)
}

describe('CurriculumMaterials', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('카드에서는 목록을 숨기고 버튼으로 모달을 열고 닫는다', async () => {
    const user = userEvent.setup()
    renderMaterials(<CurriculumMaterials materials={materials} />)

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
    renderMaterials(<CurriculumMaterials materials={[]} />)

    expect(screen.getByRole('heading', { name: '커리큘럼 강의 자료' })).toBeInTheDocument()
    expect(screen.getByText('아직 등록된 강의 자료가 없습니다.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '자료 목록' }))

    const dialog = screen.getByRole('dialog', { name: '커리큘럼 강의 자료' })
    expect(
      within(dialog).getByText('등록된 강의 자료가 없습니다. 자료가 등록되면 이곳에서 확인할 수 있습니다.'),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole('list')).not.toBeInTheDocument()
  })

  it('downloadRequest를 주면 자료마다 그 자료를 가리키는 다운로드 버튼을 붙인다', async () => {
    const user = userEvent.setup()
    const fetchMaterial = vi
      .spyOn(materialDownloadService, 'fetchMaterial')
      .mockResolvedValue(new Blob(['bytes']))
    renderMaterials(<CurriculumMaterials materials={materials} downloadRequest={downloadRequest} />)

    await user.click(screen.getByRole('button', { name: '자료 목록' }))

    const dialog = screen.getByRole('dialog', { name: '커리큘럼 강의 자료' })
    await user.click(within(dialog).getByRole('button', { name: '공통 실습 환경 설정.pptx 다운로드' }))

    // presigned URL에는 원본 파일명이 없다 — 저장될 이름을 요청이 함께 들고 가야 한다.
    expect(fetchMaterial).toHaveBeenCalledWith({
      scope: 'CURRICULUM',
      parentId: 'cur-1',
      materialId: 'material-1',
      fileName: '공통 실습 환경 설정.pptx',
    })

    await user.click(within(dialog).getByRole('button', { name: 'Spring Boot 커리큘럼 가이드.pptx 다운로드' }))
    expect(fetchMaterial).toHaveBeenLastCalledWith(expect.objectContaining({ materialId: 'material-2' }))
  })

  // 예전엔 링크였다 — 수강 관계가 없어 403이 와도 화면에 아무 일도 일어나지 않았다.
  it('다운로드가 실패하면 이유를 토스트로 알린다', async () => {
    const user = userEvent.setup()
    vi.spyOn(materialDownloadService, 'fetchMaterial').mockRejectedValue(new ApiError('forbidden', 403))
    renderMaterials(<CurriculumMaterials materials={materials} downloadRequest={downloadRequest} />)

    await user.click(screen.getByRole('button', { name: '자료 목록' }))
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: '공통 실습 환경 설정.pptx 다운로드' }),
    )

    const toastRegion = await screen.findByRole('region', { name: '알림' })
    expect(
      await within(toastRegion).findByText('수강 중인 커리큘럼의 자료만 내려받을 수 있어요.'),
    ).toBeInTheDocument()
  })

  it('downloadRequest가 없으면 다운로드 버튼을 붙이지 않는다', async () => {
    const user = userEvent.setup()
    renderMaterials(<CurriculumMaterials materials={materials} />)

    await user.click(screen.getByRole('button', { name: '자료 목록' }))

    const dialog = screen.getByRole('dialog', { name: '커리큘럼 강의 자료' })
    expect(within(dialog).queryByRole('button', { name: /다운로드$/ })).not.toBeInTheDocument()
  })
})
