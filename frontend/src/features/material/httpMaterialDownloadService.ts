import { apiClient } from '@/shared/api/client'
import { materialDownloadPath } from './materialDownloadPath'
import type { MaterialDownloadRequest, MaterialDownloadService } from './materialDownloadService.interface'

/** PPTX는 수십 MB까지 간다. apiClient 기본 15초로는 느린 회선에서 끊긴다. */
const DOWNLOAD_TIMEOUT_MS = 60_000

export const httpMaterialDownloadService: MaterialDownloadService = {
  async fetchMaterial(request: MaterialDownloadRequest) {
    const { data } = await apiClient.get<Blob>(materialDownloadPath(request), {
      responseType: 'blob',
      timeout: DOWNLOAD_TIMEOUT_MS,
      /*
       * 서버는 스토리지 presigned GET URL로 302를 주고 XHR이 그 리다이렉트를 따라가므로,
       * 이 요청은 결국 스토리지에 닿는다. 그런데 자격증명을 실으면 로컬에서 깨진다 — MinIO는
       * 다른 포트(:9000)라 교차 출처인데 `Access-Control-Allow-Origin: *`로 답하고, 브라우저는
       * 자격증명 요청에 와일드카드 허용을 인정하지 않아 응답을 통째로 버린다.
       * 첫 요청은 same-origin(`/api`)이라 이 옵션과 무관하게 세션 쿠키가 실리므로 꺼도 안전하다.
       * (운영은 presigned URL도 앱과 같은 도메인이라 애초에 교차 출처가 아니다 —
       * ASSET_STORAGE_ENDPOINT가 공개 도메인이고 nginx가 MinIO로 프록시한다.)
       */
      withCredentials: false,
    })
    return data
  },
}
