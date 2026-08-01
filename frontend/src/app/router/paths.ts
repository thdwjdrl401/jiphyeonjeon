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

export function getRoleHomePath(role: UserRole) {
  return role === 'INSTRUCTOR' ? instructorPaths.curriculums : studentPaths.curriculums
}
