import architectureCurriculumImage from '@/assets/images/curriculum-architecture.svg'
import dataCurriculumImage from '@/assets/images/curriculum-data.svg'
import springCurriculumImage from '@/assets/images/curriculum-spring.svg'

export const demoCurriculum = {
  curriculumId: 'cur_spring_live',
  title: '라이브로 완성하는 Spring Boot',
  summary: '현업의 요청 흐름을 따라가며 견고한 백엔드를 함께 설계합니다.',
  description: '라이브 코딩과 질문, 다시보기를 하나의 학습 흐름으로 연결하는 8주 과정입니다.',
  lifecycleStatus: 'PUBLISHED',
  startsAt: '2026-08-03T19:00:00+09:00',
  endsAt: '2026-09-24T21:00:00+09:00',
  instructor: '이도현',
  enrolleeCount: 48,
  thumbnailUrl: springCurriculumImage,
}

export const demoSections = [
  {
    sectionId: 'sec_foundation',
    title: '서비스의 뼈대 세우기',
    description: '요청 흐름과 계층의 책임을 정리합니다.',
    lessons: [
      { lessonId: 'les_orientation', title: '오리엔테이션과 개발 환경', status: 'PUBLISHED' },
      { lessonId: 'les_request_flow', title: 'HTTP 요청 흐름 해부하기', status: 'PUBLISHED' },
      { lessonId: 'les_service_layer', title: '서비스 계층과 트랜잭션', status: 'READY' },
    ],
  },
  {
    sectionId: 'sec_security',
    title: '인증과 인가',
    description: '세션 기반 인증과 안전한 권한 경계를 구현합니다.',
    lessons: [
      { lessonId: 'les_security', title: 'Spring Security 시작하기', status: 'PUBLISHED' },
      { lessonId: 'les_session', title: 'Redis 세션과 CSRF', status: 'AI_NOT_READY' },
    ],
  },
]

export const demoLesson = {
  lessonId: 'les_security',
  title: 'Spring Security 시작하기',
  description: '인증 필터와 세션의 흐름을 실제 요청을 따라가며 이해합니다.',
  lessonStatus: 'PUBLISHED',
  sectionTitle: '인증과 인가',
  materials: [
    { id: 'mat_security', name: 'spring-security-basics.pptx', size: '3.4 MB', status: 'READY' },
    { id: 'mat_session', name: 'session-and-csrf.pptx', size: '2.1 MB', status: 'READY' },
  ],
}

export const demoSession = {
  sessionId: 'ses_security_live',
  lessonId: demoLesson.lessonId,
  status: 'OPEN',
  scheduledAt: '2026-08-01T10:00:00+09:00',
  entryOpensAt: '2026-08-01T09:50:00+09:00',
  expectedDurationMinutes: 90,
  participants: 128,
}

export const demoMessages = [
  { id: 'msg_1', alias: '수강생-14A2', text: '세션과 JWT를 함께 쓰는 경우도 있나요?', time: '10:14', question: true },
  { id: 'msg_2', alias: '수강생-09C1', text: '필터 순서가 왜 중요한지 이해됐어요.', time: '10:16', question: false },
  { id: 'msg_3', alias: '이도현 강사', text: '좋은 질문이에요. 다음 예제에서 바로 비교해 볼게요.', time: '10:17', question: false },
]

export const demoCaptions = [
  { at: '12:08', text: '인증이 끝난 뒤에는 SecurityContext가 현재 요청의 사용자 정보를 보관합니다.' },
  { at: '12:24', text: '이 경계를 서비스 계층의 권한 검사와 함께 보겠습니다.' },
  { at: '12:41', text: '세션 저장소를 Redis로 분리하면 여러 서버가 같은 인증 상태를 공유할 수 있습니다.' },
]

export const demoInstructorCurriculums = [
  { ...demoCurriculum, publishedLessonCount: 3, lessonCount: 5, nextSession: '8월 1일 오전 10:00' },
  {
    ...demoCurriculum,
    curriculumId: 'cur_architecture',
    title: '확장 가능한 서비스 아키텍처',
    summary: '작은 서비스가 성장할 때 필요한 경계와 운영 전략을 설계합니다.',
    lifecycleStatus: 'DRAFT',
    thumbnailUrl: architectureCurriculumImage,
    publishedLessonCount: 0,
    lessonCount: 7,
    nextSession: '일정 미정',
  },
]

export const demoStudentCurriculums = [
  { ...demoCurriculum, progress: 42, completedLessonCount: 7, lessonCount: 18, lastLessonId: 'les_security' },
  {
    ...demoCurriculum,
    curriculumId: 'cur_data_story',
    title: '데이터로 설득하는 시각화',
    instructor: '박세린',
    thumbnailUrl: dataCurriculumImage,
    progress: 76,
    completedLessonCount: 9,
    lessonCount: 12,
    lastLessonId: 'les_chart',
  },
]
