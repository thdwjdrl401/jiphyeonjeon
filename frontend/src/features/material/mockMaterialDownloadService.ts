import { materialDownloadPath } from './materialDownloadPath'
import type { MaterialDownloadRequest, MaterialDownloadService } from './materialDownloadService.interface'

/**
 * mock 모드에는 진짜 PPTX 바이트가 없다. 그렇다고 다운로드만 HTTP로 빠지면
 * `VITE_USE_MOCK_API=true`에서 이 흐름을 아예 눌러볼 수 없으므로(요청이 차단된다),
 * 같은 파일명으로 자리표시 텍스트를 내려준다. 저장까지 도는지 확인하는 용도이고
 * 파워포인트로 열리는 문서는 아니다.
 */
export const mockMaterialDownloadService: MaterialDownloadService = {
  async fetchMaterial(request: MaterialDownloadRequest) {
    const lines = [
      'mock 강의 자료 자리표시 파일입니다.',
      `파일명: ${request.fileName}`,
      `요청 경로: /api${materialDownloadPath(request)}`,
    ]
    return new Blob([`${lines.join('\n')}\n`], { type: 'text/plain' })
  },
}
