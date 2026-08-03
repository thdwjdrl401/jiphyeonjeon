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

export const studentPaths = {
  root: '/student',
  profile: '/student/profile',
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
  curriculums: '/instructor/curriculums',
  newCurriculum: '/instructor/curriculums/new',
  curriculumManage: (curriculumId: string) => `/instructor/curriculums/${curriculumId}/manage`,
  lesson: (curriculumId: string, sectionId: string, lessonId: string) =>
    `/instructor/curriculums/${curriculumId}/sections/${sectionId}/lessons/${lessonId}`,
  newLesson: (curriculumId: string, sectionId: string) =>
    `/instructor/curriculums/${curriculumId}/sections/${sectionId}/lessons/new`,
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
