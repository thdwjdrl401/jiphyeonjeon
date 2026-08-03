import type { UserRole } from '@/features/auth/types'

export const publicPaths = {
  home: '/',
  login: '/login',
  signup: '/signup',
  // 비밀번호 재설정은 로그인을 못 하는 사람이 쓰는 흐름이라 공개 경로에 둔다.
  passwordResetRequest: '/password-reset',
  passwordResetConfirm: (token?: string) =>
    token ? `/password-reset/confirm?token=${encodeURIComponent(token)}` : '/password-reset/confirm',
  curriculums: '/curriculums',
  curriculum: (curriculumId: string) => `/curriculums/${curriculumId}`,
  forbidden: (reason?: 'student' | 'instructor' | 'enrollment' | 'ownership') =>
    reason ? `/forbidden?reason=${reason}` : '/forbidden',
}

/**
 * 커리큘럼 관리 화면의 탭. 탭 선택이 URL에 남아야 알림·북마크·새로고침이 같은 탭을 다시 연다 —
 * 로컬 state에만 두면 "수강생 탭으로 이동"을 링크로 표현할 수 없다.
 */
export type CurriculumManageTab = 'info' | 'structure' | 'enrollees'

/** 관리 화면 딥링크의 쿼리 키. 만드는 쪽(알림)과 읽는 쪽(관리 화면)이 같은 상수를 쓴다. */
export const curriculumManageParams = {
  tab: 'tab',
  enrollmentStatus: 'enrollmentStatus',
  highlightEnrollment: 'highlightEnrollment',
} as const

export interface CurriculumManageOptions {
  tab?: CurriculumManageTab
  /** 수강생 탭의 초기 상태 필터(`PENDING` 등). 승인 대기 목록으로 바로 들어가게 한다. */
  enrollmentStatus?: string
  /** 목록에서 강조할 수강 신청. 어느 신청 때문에 왔는지 화면에서 보이게 한다. */
  highlightEnrollmentId?: string
}

function withQuery(path: string, entries: Array<[string, string | undefined]>) {
  const query = new URLSearchParams()
  for (const [key, value] of entries) {
    if (value) query.set(key, value)
  }
  const search = query.toString()
  return search ? `${path}?${search}` : path
}

export const studentPaths = {
  root: '/student',
  profile: '/student/profile',
  notifications: '/student/notifications',
  curriculums: '/student/curriculums',
  lesson: (curriculumId: string, sectionId: string, lessonId: string) =>
    `/student/curriculums/${curriculumId}/sections/${sectionId}/lessons/${lessonId}`,
  liveUpcoming: (curriculumId: string, lessonId: string) =>
    `/student/curriculums/${curriculumId}/lessons/${lessonId}/live-upcoming`,
  prejoin: (sessionId: string) => `/student/live-sessions/${sessionId}/prejoin`,
  classroom: (sessionId: string) => `/student/live-sessions/${sessionId}/classroom`,
  replay: (lessonId: string) => `/student/lessons/${lessonId}/replay`,
}

export const instructorPaths = {
  root: '/instructor',
  profile: '/instructor/profile',
  notifications: '/instructor/notifications',
  curriculums: '/instructor/curriculums',
  newCurriculum: '/instructor/curriculums/new',
  curriculumManage: (curriculumId: string, options: CurriculumManageOptions = {}) =>
    withQuery(`/instructor/curriculums/${curriculumId}/manage`, [
      [curriculumManageParams.tab, options.tab],
      [curriculumManageParams.enrollmentStatus, options.enrollmentStatus],
      [curriculumManageParams.highlightEnrollment, options.highlightEnrollmentId],
    ]),
  lesson: (curriculumId: string, sectionId: string, lessonId: string) =>
    `/instructor/curriculums/${curriculumId}/sections/${sectionId}/lessons/${lessonId}`,
  newLesson: (curriculumId: string, sectionId: string) =>
    `/instructor/curriculums/${curriculumId}/sections/${sectionId}/lessons/new`,
  newRecordedLesson: (curriculumId: string, sectionId: string) =>
    `/instructor/curriculums/${curriculumId}/sections/${sectionId}/recorded-lessons/new`,
  recordedLesson: (curriculumId: string, sectionId: string, lessonId: string) =>
    `/instructor/curriculums/${curriculumId}/sections/${sectionId}/recorded-lessons/${lessonId}`,
  editLesson: (curriculumId: string, sectionId: string, lessonId: string) =>
    `/instructor/curriculums/${curriculumId}/sections/${sectionId}/lessons/${lessonId}/edit`,
  preflight: (sessionId: string) => `/instructor/live-sessions/${sessionId}/preflight`,
  classroom: (sessionId: string) => `/instructor/live-sessions/${sessionId}/classroom`,
  processing: (sessionId: string) => `/instructor/live-sessions/${sessionId}/processing`,
  replay: (lessonId: string) => `/instructor/lessons/${lessonId}/replay`,
}

/**
 * 운영 콘솔. 가입 역할과 무관한 축이라 student/instructor와 나란히 두지 않고 별도 트리로 둔다 —
 * 강사 화면 밑에 얹으면 "강사=운영자"라는 잘못된 전제가 경로에 굳는다(처음 Egress 콘솔이
 * `/instructor/egress`에 있었고, 그래서 메뉴에 걸 자리가 없어 URL을 직접 쳐야 했다).
 */
export const adminPaths = {
  root: '/admin',
  overview: '/admin',
  egress: '/admin/egress',
}

export function getRoleHomePath(role: UserRole) {
  return role === 'INSTRUCTOR' ? instructorPaths.curriculums : studentPaths.curriculums
}

/**
 * 본인 프로필("내 프로필") 경로. 역할마다 트리가 갈려서 경로도 갈리는데, 헤더·사이드바가
 * 각자 삼항식을 두면 한쪽만 고쳐지는 일이 생긴다 — 판별은 여기 한 곳에서만 한다.
 */
export function getProfilePath(role: UserRole) {
  return role === 'INSTRUCTOR' ? instructorPaths.profile : studentPaths.profile
}

/** 알림 페이지 경로. 헤더 종과 알림 목록이 각자 역할 삼항식을 두지 않게 여기서만 판별한다. */
export function getNotificationsPath(role: UserRole) {
  return role === 'INSTRUCTOR' ? instructorPaths.notifications : studentPaths.notifications
}
