import { matchPath } from 'react-router-dom'
import type { UserRole } from '@/features/auth/types'
import { adminPaths, instructorPaths, publicPaths, studentPaths } from './paths'

/**
 * 상단 네비게이션 항목 하나.
 *
 * `activePatterns`가 `to` 말고 따로 있는 이유: 활성 판정은 링크 목적지보다 넓다. 강사가
 * 커리큘럼 관리·강의 편집·라이브 점검 화면에 있어도 "커리큘럼 관리"가 켜져 있어야 하는데,
 * 그 화면들의 경로는 `to`와 다르다. 경로 완전 일치로 판정하면 하위 화면에서 표시가 꺼진다.
 */
export interface NavigationItem {
  label: string
  to: string
  /** 이 항목을 활성으로 볼 경로들. 각각 하위 경로까지 포함해 판정한다(`end: false`). */
  activePatterns: string[]
  /**
   * 활성에서 뺄 경로들. 더 구체적인 형제 항목이 가진 경로를 적는다 —
   * `/instructor/curriculums/new`는 "커리큘럼 만들기"의 것이므로 "커리큘럼 관리"는 꺼져야 한다.
   */
  inactivePatterns?: string[]
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
      label: '커리큘럼 관리',
      to: studentPaths.curriculums,
      // 학습 목록·강의 학습·라이브 입장 전 점검까지 모두 "커리큘럼 관리" 축이다.
      activePatterns: [studentPaths.curriculums, '/student/live-sessions', '/student/lessons'],
    },
  ],
  INSTRUCTOR: [
    exploreCurriculums,
    {
      label: '커리큘럼 관리',
      to: instructorPaths.curriculums,
      // 목록·관리·강의 편집·라이브 점검·녹화 처리까지 모두 "커리큘럼 관리" 축이다.
      activePatterns: [instructorPaths.curriculums, '/instructor/live-sessions', '/instructor/lessons'],
      inactivePatterns: [instructorPaths.newCurriculum],
    },
    {
      label: '커리큘럼 만들기',
      to: instructorPaths.newCurriculum,
      activePatterns: [instructorPaths.newCurriculum],
    },
  ],
}

/**
 * 운영 콘솔. 가입 역할(`role`)이 아니라 서버 allowlist(`isAdmin`)로 갈리는 별도 축이라
 * 역할 표에 넣지 않는다. 메뉴에서 빠지면 URL을 직접 쳐야 하므로 자리는 남겨 둔다.
 */
export const adminNavigationItem: NavigationItem = {
  label: '운영 콘솔',
  to: adminPaths.overview,
  activePatterns: [adminPaths.root],
}

/** 내 프로필 영역의 활성 판정. 역할별 경로 둘 중 하나에 있으면 켠다. */
const profilePatterns = [studentPaths.profile, instructorPaths.profile]

export function isNavigationItemActive(item: NavigationItem, pathname: string) {
  if (item.inactivePatterns?.some((path) => matchPath({ path, end: false }, pathname))) return false
  return item.activePatterns.some((path) => matchPath({ path, end: false }, pathname))
}

export function isProfileAreaActive(pathname: string) {
  return profilePatterns.some((path) => matchPath({ path, end: false }, pathname))
}
