import type { ReactElement } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CurriculumMaterialField from '@/features/curriculum/CurriculumMaterialField'
import type { CurriculumMaterial } from '@/features/curriculum/types'
import * as materialDownloadService from '@/features/material/materialDownloadService'
import { ApiError } from '@/shared/api/client'
import { ToastProvider } from '@/shared/ui/Toast'

const persisted: CurriculumMaterial = {
  materialId: 'mat-1',
  fileName: '공통 실습 환경 설정.pptx',
  fileSize: 34 * 1024,
}

const downloadRequest = (material: CurriculumMaterial) => ({
  scope: 'CURRICULUM' as const,
  parentId: 'cur-1',
  materialId: material.materialId,
  fileName: material.fileName,
  asInstructor: true,
})

function renderField(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>)
}

describe('CurriculumMaterialField 다운로드', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /*
   * 스토리지 객체 키가 `material/{UUID}`라(AssetService) presigned URL을 링크로 그대로 열면
   * 확장자도 없는 UUID로 저장된다. 파일명은 화면이 들고 있어야 한다.
   */
  it('저장된 자료를 원래 파일명으로 내려받는다', async () => {
    const user = userEvent.setup()
    const fetchMaterial = vi
      .spyOn(materialDownloadService, 'fetchMaterial')
      .mockResolvedValue(new Blob(['bytes']))
    renderField(
      <CurriculumMaterialField
        id="manage-materials"
        value={[persisted]}
        onChange={() => {}}
        downloadRequest={downloadRequest}
      />,
    )

    await user.click(screen.getByRole('button', { name: '공통 실습 환경 설정.pptx 다운로드' }))

    expect(fetchMaterial).toHaveBeenCalledWith({
      scope: 'CURRICULUM',
      parentId: 'cur-1',
      materialId: 'mat-1',
      fileName: '공통 실습 환경 설정.pptx',
      asInstructor: true,
    })
  })

  it('다운로드가 실패하면 토스트로 알린다', async () => {
    const user = userEvent.setup()
    vi.spyOn(materialDownloadService, 'fetchMaterial').mockRejectedValue(new ApiError('gone', 404))
    renderField(
      <CurriculumMaterialField
        id="manage-materials"
        value={[persisted]}
        onChange={() => {}}
        downloadRequest={downloadRequest}
      />,
    )

    await user.click(screen.getByRole('button', { name: '공통 실습 환경 설정.pptx 다운로드' }))

    const toastRegion = await screen.findByRole('region', { name: '알림' })
    expect(await screen.findByText(/자료를 찾을 수 없어요/)).toBeInTheDocument()
    expect(toastRegion).toBeInTheDocument()
  })

  // 아직 저장 전인 자료(File을 들고 있음)는 서버에 없으므로 내려받을 대상이 아니다.
  it('저장 전 자료에는 다운로드 버튼을 붙이지 않는다', () => {
    const pending: CurriculumMaterial = {
      materialId: 'local-1',
      fileName: '새로 고른 자료.pptx',
      fileSize: 1024,
      file: new File(['x'], '새로 고른 자료.pptx'),
    }
    renderField(
      <CurriculumMaterialField
        id="manage-materials"
        value={[pending]}
        onChange={() => {}}
        downloadRequest={downloadRequest}
      />,
    )

    expect(screen.queryByRole('button', { name: /다운로드$/ })).not.toBeInTheDocument()
  })

  it('downloadRequest가 없으면(새 커리큘럼 만들기) 다운로드 버튼이 없다', () => {
    renderField(
      <CurriculumMaterialField id="new-materials" value={[persisted]} onChange={() => {}} />,
    )

    expect(screen.queryByRole('button', { name: /다운로드$/ })).not.toBeInTheDocument()
  })
})
