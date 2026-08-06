import { matchPath } from 'react-router-dom'
import type { UserRole } from '@/features/auth/types'
import { adminPaths, instructorPaths, publicPaths, studentPaths } from './paths'

/**
 * 상단 네비게이션 항목 하나.
 *
 * `activePatterns`가 `to` 말고 따로 있는 이유: 메뉴가 활성인 화면을 명시적으로 제한한다.
 * 공개 상세나 강의 편집처럼 어느 메뉴에도 속하지 않는 화면에서는 밑줄을 표시하지 않는다.
 */
export interface NavigationItem {
  label: string
  to: string
  /** 이 항목을 활성으로 볼 경로들. React Router 패턴과 완전히 일치할 때만 활성화한다. */
  activePatterns: string[]
}

/** 학생·강사가 같이 쓰는 공개 탐색 메뉴. 두 역할 배열에서 같은 정의를 공유한다. */
const exploreCurriculums: NavigationItem = {
  label: '커리큘럼 탐색',
  to: publicPaths.curriculums,
  activePatterns: [publicPaths.curriculums],
}

/**
 * 역할별 메뉴 정의. 화면 컴포넌트는 이 표를 읽기만 하고 자기 안에서 역할 조건문을 만들지 않는다.
 * 역할이 늘어나면 Record 타입이 빠진 키를 타입 검사에서 잡는다.
 */
export const navigationItemsByRole: Record<UserRole, NavigationItem[]> = {
  STUDENT: [
    exploreCurriculums,
    {
      label: '마이 페이지',
      to: studentPaths.curriculums,
      activePatterns: [studentPaths.curriculums, studentPaths.profile, studentPaths.notifications],
    },
  ],
  INSTRUCTOR: [
    exploreCurriculums,
    {
      label: '마이 페이지',
      to: instructorPaths.curriculums,
      activePatterns: [
        instructorPaths.curriculums,
        '/instructor/curriculums/:curriculumId/manage',
        instructorPaths.profile,
        instructorPaths.notifications,
      ],
    },
  ],
}

/**
 * 운영 콘솔. 가입 역할(`role`)이 아니라 서버 allowlist(`isAdmin`)로 갈리는 별도 축이라
 * 역할 표에 넣지 않는다. 상단 텍스트 메뉴가 아니라 프로필 드롭다운 안에서 노출된다.
 */
export const adminNavigationItem: NavigationItem = {
  label: '운영 콘솔',
  to: adminPaths.overview,
  activePatterns: [adminPaths.root],
}

/** 내 프로필 영역의 활성 판정. 역할별 경로 둘 중 하나에 있으면 켠다. */
const profilePatterns = [studentPaths.profile, instructorPaths.profile]

export function isNavigationItemActive(item: NavigationItem, pathname: string) {
  return item.activePatterns.some((path) => matchPath({ path, end: true }, pathname))
}

export function isProfileAreaActive(pathname: string) {
  return profilePatterns.some((path) => matchPath({ path, end: false }, pathname))
}
