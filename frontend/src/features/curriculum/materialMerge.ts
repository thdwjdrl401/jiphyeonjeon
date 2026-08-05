import type { CurriculumMaterial } from './types'

/**
 * 자료 한 건을 저장 전후로 같게 식별하는 키. 파일 이름과 크기로 잡는다 — 새로 고른 자료의 임시
 * materialId는 저장 후 실제 id로 바뀌므로 id로는 "같은 자료"를 알아볼 수 없다(자동 저장 지문이
 * 같은 키를 쓰는 것과 같은 이유, ADR-0042).
 */
function materialKey(material: CurriculumMaterial): string {
  return `${material.fileName}:${material.fileSize}`
}

/**
 * 서버에 저장된 자료 목록과 화면의 로컬 목록을 합친다(ADR-0077).
 *
 * <p><b>서버 목록이 진실이고</b>, 그 위에 <b>아직 서버에 없는 로컬 선택(File 보유)만</b> 남긴다.
 *
 * <p>저장 응답으로 로컬 목록을 통째로 덮으면 두 가지가 조용히 깨진다.
 *
 * <ol>
 *   <li>저장이 도는 <b>동안</b> 사용자가 고른 파일이 사라진다 — 자동 저장은 진행 중 요청을 기다리게만
 *       하고(savingRef), 완료 응답이 그 사이 추가된 선택을 덮어 버렸다.</li>
 *   <li>부분 실패 후 <b>이미 붙은 자료가 계속 "업로드 대기"로 남는다</b> — 다음 저장이 그 파일을 서버에서
 *       지우고 새 에셋으로 다시 올려(고아 파일) 같은 일을 반복했다.</li>
 * </ol>
 */
export function mergeCurriculumMaterials(
  persisted: CurriculumMaterial[],
  local: CurriculumMaterial[],
): CurriculumMaterial[] {
  const persistedKeys = new Set(persisted.map(materialKey))
  return [
    ...persisted,
    ...local.filter((material) => material.file && !persistedKeys.has(materialKey(material))),
  ]
}
