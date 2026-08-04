import type { CurriculumMaterial } from './types'

/**
 * 자료 동기화가 <b>부분 성공</b>한 채로 실패했음을 알리는 오류(ADR-0077).
 *
 * <p>자료는 파일마다 업로드→연결이라 한 트랜잭션으로 묶이지 않는다. 세 번째 파일에서 실패했다면
 * 앞의 두 개는 이미 서버에 붙어 있다. 그 사실을 버리고 "저장 실패"만 올리면, 화면은 붙은 자료를 계속
 * 미저장으로 알고 다음 저장에서 <b>서버에서 지우고 새 에셋으로 다시 올린다</b> — 매번 고아 파일이
 * 하나씩 쌓이고 사용자에게는 아무 변화가 없어 보인다.
 *
 * <p>그래서 실패도 <b>서버의 현재 자료 목록을 함께</b> 올린다. 화면은 그 목록으로 로컬 상태를 맞추고,
 * 실패한 파일만 대기로 남긴다.
 */
export class CurriculumMaterialSyncError extends Error {
  /** 실패 시점의 서버 자료 목록(진실). 여기까지 붙은 자료가 들어 있다. */
  readonly persistedMaterials: CurriculumMaterial[]

  /** 원래 실패(업로드·연결 오류). 진단 로그용 — 사용자 문구는 message를 그대로 쓴다. */
  readonly reason: unknown

  constructor(reason: unknown, persistedMaterials: CurriculumMaterial[]) {
    super(reason instanceof Error ? reason.message : String(reason))
    this.name = 'CurriculumMaterialSyncError'
    this.reason = reason
    this.persistedMaterials = persistedMaterials
  }
}
