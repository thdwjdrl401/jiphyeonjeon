import { StatusBadge } from '@/shared/ui/WorkspaceUi'
import {
  instructorMaterialBadges,
  studentMaterialBadge,
  type MaterialStatusSource,
} from './materialStatus'

interface MaterialStatusBadgesProps {
  material: MaterialStatusSource
  /**
   * 보는 사람. 강사는 임베딩·용어 추출 상태를 그대로 보고, 수강생은 "준비 중"만 본다
   * (`materialStatus.ts`의 두 함수 주석 참고).
   */
  audience: 'instructor' | 'student'
}

/**
 * 자료 한 건의 준비 상태 배지. 목록 항목 안에서 그대로 쓴다.
 *
 * 배지를 만들 게 없으면 아무것도 그리지 않는다 — 준비가 끝난 자료 옆에 "완료"를 줄줄이 세우면
 * 정작 기다려야 하는 자료가 묻힌다(수강생 화면 기준).
 */
export default function MaterialStatusBadges({ material, audience }: MaterialStatusBadgesProps) {
  const badges = audience === 'instructor'
    ? instructorMaterialBadges(material)
    : [studentMaterialBadge(material)].filter((badge) => badge !== null)

  if (badges.length === 0) return null

  return (
    <>
      {badges.map((badge) => (
        <StatusBadge key={badge.label} tone={badge.tone} busy={badge.busy} title={badge.title}>
          {badge.label}
        </StatusBadge>
      ))}
    </>
  )
}
