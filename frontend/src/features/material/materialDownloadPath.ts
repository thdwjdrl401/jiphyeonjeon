import type { MaterialDownloadRequest } from './materialDownloadService.interface'

/**
 * 자료 다운로드 경로(`apiClient` 기준 — baseURL `/api`가 앞에 붙는다).
 *
 * 네 갈래(커리큘럼·레슨 × 수강생·강사)를 화면마다 문자열로 짜맞추던 것을 여기 모았다.
 * 경로가 어긋나도 링크는 멀쩡해 보이고 누르면 404만 나므로 눈에 잘 띄지 않는다.
 */
export function materialDownloadPath({
  scope,
  parentId,
  materialId,
  asInstructor,
}: MaterialDownloadRequest): string {
  const parent = scope === 'CURRICULUM' ? 'curriculums' : 'lessons'
  return `${asInstructor ? '/instructor' : ''}/${parent}/${parentId}/materials/${materialId}/download`
}
