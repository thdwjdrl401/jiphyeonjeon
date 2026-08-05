/**
 * 받아 온 바이트를 파일로 저장시킨다.
 *
 * 다운로드 경로를 링크로 그냥 열면 이름이 망가진다 — 서버가 스토리지 presigned URL로 302를 주는데
 * 그 URL에는 원본 파일명이 없고(객체 키가 곧 이름), `download` 속성은 최종 응답이 교차 출처면
 * 무시된다. 바이트를 먼저 받아 온 뒤 여기서 이름을 붙인다.
 */
export function saveBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 클릭 직후 해제하면 브라우저가 저장을 시작하기 전에 URL이 사라질 수 있다.
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
}
