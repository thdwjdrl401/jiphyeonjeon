import { afterEach, describe, expect, it, vi } from 'vitest'
import { materialDownloadPath } from '@/features/material/materialDownloadPath'
import { mockMaterialDownloadService } from '@/features/material/mockMaterialDownloadService'
import { describeMaterialDownloadError } from '@/features/material/useMaterialDownload'
import { ApiError } from '@/shared/api/client'
import { saveBlob } from '@/shared/lib/saveBlob'

/** jsdom의 Blob에는 `text()`가 없다. FileReader로 읽는다. */
function readBlobText(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

describe('materialDownloadPath', () => {
  // 경로가 어긋나도 화면은 멀쩡해 보이고 눌러야 404가 난다 — 네 갈래를 여기서 못 박는다.
  it('스코프와 역할에 따라 네 갈래 경로를 만든다', () => {
    const base = { materialId: 'mat-1', fileName: 'guide.pptx' }

    expect(materialDownloadPath({ ...base, scope: 'CURRICULUM', parentId: 'cur-1' }))
      .toBe('/curriculums/cur-1/materials/mat-1/download')
    expect(materialDownloadPath({ ...base, scope: 'CURRICULUM', parentId: 'cur-1', asInstructor: true }))
      .toBe('/instructor/curriculums/cur-1/materials/mat-1/download')
    expect(materialDownloadPath({ ...base, scope: 'LESSON', parentId: 'les-1' }))
      .toBe('/lessons/les-1/materials/mat-1/download')
    expect(materialDownloadPath({ ...base, scope: 'LESSON', parentId: 'les-1', asInstructor: true }))
      .toBe('/instructor/lessons/les-1/materials/mat-1/download')
  })
})

describe('describeMaterialDownloadError', () => {
  // CONTRACT §수강생 자료 다운로드 접근 계약의 401·403·404를 수강생이 읽을 말로 옮긴다.
  it('계약 상태 코드마다 다른 안내를 준다', () => {
    expect(describeMaterialDownloadError(new ApiError('x', 401))).toContain('로그인')
    expect(describeMaterialDownloadError(new ApiError('x', 403))).toContain('수강 중인 커리큘럼')
    expect(describeMaterialDownloadError(new ApiError('x', 404))).toContain('찾을 수 없어요')
  })

  it('그 밖의 실패는 재시도를 안내한다', () => {
    expect(describeMaterialDownloadError(new ApiError('x', 500))).toContain('다시 시도')
    expect(describeMaterialDownloadError(new Error('network'))).toContain('다시 시도')
  })
})

describe('saveBlob', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // presigned URL에는 원본 파일명이 없다 — 저장될 이름은 받아 온 바이트에 여기서 붙인다.
  it('원하는 파일명으로 저장을 트리거하고 objectURL을 되돌려 준다', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:saved')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clicked: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clicked.push(this)
    })

    saveBlob(new Blob(['bytes']), '공통 실습 환경 설정.pptx')

    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe('공통 실습 환경 설정.pptx')
    expect(clicked[0].href).toContain('blob:saved')
    expect(clicked[0].isConnected).toBe(false)

    // 해제는 다음 틱이다 — 클릭 직후 지우면 저장이 시작되기 전에 URL이 사라진다.
    expect(revokeObjectURL).not.toHaveBeenCalled()
    await new Promise((resolve) => setTimeout(resolve, 1))
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:saved')
  })
})

describe('mockMaterialDownloadService', () => {
  // mock 모드에서도 다운로드가 끝까지 돌아야 학생 화면을 로컬에서 눌러 볼 수 있다.
  it('자리표시 바이트를 돌려준다', async () => {
    const blob = await mockMaterialDownloadService.fetchMaterial({
      scope: 'LESSON',
      parentId: 'les-1',
      materialId: 'mat-1',
      fileName: 'guide.pptx',
    })

    expect(blob.size).toBeGreaterThan(0)
    expect(await readBlobText(blob)).toContain('/api/lessons/les-1/materials/mat-1/download')
  })
})
