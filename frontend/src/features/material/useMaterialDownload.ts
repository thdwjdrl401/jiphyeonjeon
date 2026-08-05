import { useCallback, useRef, useState } from 'react'
import { ApiError } from '@/shared/api/client'
import { isNotImplemented } from '@/shared/api/notImplemented'
import { saveBlob } from '@/shared/lib/saveBlob'
import { useToast } from '@/shared/ui/Toast'
import { fetchMaterial } from './materialDownloadService'
import type { MaterialDownloadRequest } from './materialDownloadService.interface'

/**
 * 실패 안내 문구. 상태 코드는 docs/CONTRACT.md §수강생 자료 다운로드 접근 계약을 그대로 옮긴다.
 *
 * 예전처럼 링크로 열면 이 구분이 화면에 닿지 않는다 — 수강 관계가 없어 403이 와도 브라우저는
 * 조용히 아무 일도 하지 않거나 JSON 오류 본문으로 이동해 버린다.
 */
export function describeMaterialDownloadError(error: unknown): string {
  if (isNotImplemented(error)) return '자료 다운로드가 아직 준비되지 않았어요.'
  if (error instanceof ApiError) {
    if (error.status === 401) return '로그인이 풀렸어요. 다시 로그인한 뒤 내려받아 주세요.'
    if (error.status === 403) return '수강 중인 커리큘럼의 자료만 내려받을 수 있어요.'
    if (error.status === 404) return '자료를 찾을 수 없어요. 목록을 새로고침한 뒤 다시 시도해 주세요.'
  }
  return '자료를 내려받지 못했어요. 잠시 후 다시 시도해 주세요.'
}

/**
 * 강의 자료 다운로드 한 벌(커리큘럼 공통 자료·레슨 자료 공용).
 *
 * `downloadingMaterialId`는 진행 중 표시와 중복 클릭 방지에 쓴다.
 */
export function useMaterialDownload() {
  const toast = useToast()
  const [downloadingMaterialId, setDownloadingMaterialId] = useState<string | null>(null)
  const inFlight = useRef(false)

  const download = useCallback(async (request: MaterialDownloadRequest) => {
    if (inFlight.current) return
    inFlight.current = true
    setDownloadingMaterialId(request.materialId)
    try {
      saveBlob(await fetchMaterial(request), request.fileName)
    } catch (error) {
      toast.error(describeMaterialDownloadError(error))
    } finally {
      inFlight.current = false
      setDownloadingMaterialId(null)
    }
  }, [toast])

  return { download, downloadingMaterialId }
}
