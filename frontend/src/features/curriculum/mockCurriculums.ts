import { peekMockUser } from '@/features/auth/mockAuth'
import type {
  CurriculumCardSummary,
  CurriculumListQuery,
  CurriculumListResponse,
} from './types'

type MockCurriculum = Omit<CurriculumCardSummary, 'viewerContext'> & { featured: boolean }

const curriculums: MockCurriculum[] = [
  {
    curriculumId: 'cur_spring_live',
    title: '라이브로 완성하는 Spring Boot',
    summary: '현업의 요청 흐름을 따라가며 견고한 백엔드를 함께 설계합니다.',
    thumbnailUrl: null,
    instructor: { instructorId: 'usr_instructor_01', displayName: '이도현' },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-08-03T19:00:00+09:00', endsAt: '2026-09-24T21:00:00+09:00' },
    sectionCount: 6,
    lessonCount: 18,
    featured: true,
  },
  {
    curriculumId: 'cur_data_story',
    title: '데이터로 설득하는 시각화',
    summary: '좋은 차트의 기준부터 비즈니스 스토리텔링까지 실습으로 익혀요.',
    thumbnailUrl: null,
    instructor: { instructorId: 'usr_instructor_02', displayName: '박세린' },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-07-20T20:00:00+09:00', endsAt: '2026-08-28T22:00:00+09:00' },
    sectionCount: 5,
    lessonCount: 12,
    featured: true,
  },
  {
    curriculumId: 'cur_react_system',
    title: 'React 디자인 시스템 실전',
    summary: '재사용 가능한 컴포넌트와 접근성 있는 인터랙션을 직접 구축합니다.',
    thumbnailUrl: null,
    instructor: { instructorId: 'usr_instructor_03', displayName: '최유진' },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-08-10T19:30:00+09:00', endsAt: '2026-10-05T21:30:00+09:00' },
    sectionCount: 7,
    lessonCount: 16,
    featured: true,
  },
  {
    curriculumId: 'cur_ai_product',
    title: 'AI 제품 기획자를 위한 첫걸음',
    summary: '모델의 가능성과 한계를 이해하고 검증 가능한 AI 기능을 설계해요.',
    thumbnailUrl: null,
    instructor: { instructorId: 'usr_instructor_04', displayName: '윤하람' },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-09-01T20:00:00+09:00', endsAt: '2026-10-13T22:00:00+09:00' },
    sectionCount: 4,
    lessonCount: 10,
    featured: true,
  },
  {
    curriculumId: 'cur_webrtc',
    title: 'WebRTC와 실시간 미디어',
    summary: '브라우저 미디어부터 SFU 아키텍처까지 실시간 서비스의 핵심을 다룹니다.',
    thumbnailUrl: null,
    instructor: { instructorId: 'usr_instructor_05', displayName: '정민재' },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-07-13T19:00:00+09:00', endsAt: '2026-08-31T21:00:00+09:00' },
    sectionCount: 8,
    lessonCount: 20,
    featured: true,
  },
  {
    curriculumId: 'cur_sql',
    title: '성능을 바꾸는 SQL 튜닝',
    summary: '실행 계획을 읽고 느린 쿼리의 원인을 단계적으로 찾아갑니다.',
    thumbnailUrl: null,
    instructor: { instructorId: 'usr_instructor_06', displayName: '한지수' },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-08-22T10:00:00+09:00', endsAt: '2026-09-26T12:00:00+09:00' },
    sectionCount: 5,
    lessonCount: 10,
    featured: true,
  },
  {
    curriculumId: 'cur_cloud',
    title: '처음 만나는 클라우드 아키텍처',
    summary: '확장성과 장애 대응을 중심으로 서비스 구조를 함께 그려봅니다.',
    thumbnailUrl: null,
    instructor: { instructorId: 'usr_instructor_07', displayName: '고은채' },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-09-07T19:00:00+09:00', endsAt: '2026-10-19T21:00:00+09:00' },
    sectionCount: 6,
    lessonCount: 14,
    featured: false,
  },
  {
    curriculumId: 'cur_typescript',
    title: 'TypeScript 타입 설계 워크숍',
    summary: '복잡한 도메인을 안전하고 읽기 좋은 타입으로 표현하는 연습을 합니다.',
    thumbnailUrl: null,
    instructor: { instructorId: 'usr_instructor_08', displayName: '서다온' },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-07-27T19:30:00+09:00', endsAt: '2026-09-07T21:30:00+09:00' },
    sectionCount: 5,
    lessonCount: 12,
    featured: false,
  },
  {
    curriculumId: 'cur_ux_research',
    title: '사용자를 이해하는 UX 리서치',
    summary: '인터뷰 설계부터 인사이트 도출까지 작은 팀을 위한 방법을 익혀요.',
    thumbnailUrl: null,
    instructor: { instructorId: 'usr_instructor_09', displayName: '문소연' },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-08-15T10:00:00+09:00', endsAt: '2026-09-19T12:00:00+09:00' },
    sectionCount: 4,
    lessonCount: 9,
    featured: false,
  },
  {
    curriculumId: 'cur_python',
    title: 'Python 자동화 레시피',
    summary: '반복 업무를 줄이는 작은 스크립트부터 데이터 파이프라인까지 만들어요.',
    thumbnailUrl: null,
    instructor: { instructorId: 'usr_instructor_10', displayName: '오태경' },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-09-05T13:00:00+09:00', endsAt: '2026-10-10T15:00:00+09:00' },
    sectionCount: 6,
    lessonCount: 15,
    featured: false,
  },
]

function withViewerContext(curriculum: MockCurriculum, index: number): CurriculumCardSummary {
  const user = peekMockUser()
  const summary = {
    curriculumId: curriculum.curriculumId,
    title: curriculum.title,
    summary: curriculum.summary,
    thumbnailUrl: curriculum.thumbnailUrl,
    instructor: curriculum.instructor,
    lifecycleStatus: curriculum.lifecycleStatus,
    period: curriculum.period,
    sectionCount: curriculum.sectionCount,
    lessonCount: curriculum.lessonCount,
  }

  if (!user) {
    return {
      ...summary,
      viewerContext: { relationship: 'GUEST', allowedActions: ['VIEW_DETAIL'] },
    }
  }

  if (user.role === 'INSTRUCTOR') {
    const isOwner = index === 0
    return {
      ...summary,
      viewerContext: {
        relationship: isOwner ? 'OWNER_INSTRUCTOR' : 'NON_OWNER_INSTRUCTOR',
        allowedActions: isOwner ? ['VIEW_DETAIL', 'MANAGE_CURRICULUM'] : ['VIEW_DETAIL'],
      },
    }
  }

  const isEnrolled = index % 3 === 0
  return {
    ...summary,
    viewerContext: isEnrolled
      ? {
          relationship: 'ENROLLED',
          allowedActions: ['VIEW_DETAIL', 'CONTINUE_LEARNING'],
          progress: {
            completedLessonCount: Math.max(1, Math.floor(curriculum.lessonCount * 0.36)),
            totalLessonCount: curriculum.lessonCount,
            progressPercent: 36,
          },
        }
      : {
          relationship: 'UNENROLLED_STUDENT',
          allowedActions: ['VIEW_DETAIL', 'ENROLL'],
        },
  }
}

export async function getMockCurriculums(query: CurriculumListQuery): Promise<CurriculumListResponse> {
  if (import.meta.env.MODE !== 'test') {
    await new Promise((resolve) => window.setTimeout(resolve, 420))
  }

  const search = query.q?.trim().toLocaleLowerCase('ko')
  let filtered = curriculums.filter((curriculum) => {
    if (query.featured && !curriculum.featured) return false
    if (!search) return true
    return [curriculum.title, curriculum.summary, curriculum.instructor.displayName]
      .join(' ')
      .toLocaleLowerCase('ko')
      .includes(search)
  })

  if (query.sort === 'TITLE_ASC') {
    filtered = [...filtered].sort((a, b) => a.title.localeCompare(b.title, 'ko'))
  } else if (query.sort === 'STARTING_SOON') {
    filtered = [...filtered].sort((a, b) =>
      (a.period?.startsAt ?? '').localeCompare(b.period?.startsAt ?? ''),
    )
  }

  const page = query.page ?? 0
  const size = query.size ?? 9
  const start = page * size
  const items = filtered
    .slice(start, start + size)
    .map((curriculum) => withViewerContext(curriculum, curriculums.indexOf(curriculum)))
  const totalPages = Math.ceil(filtered.length / size)

  return {
    items,
    page,
    size,
    totalElements: filtered.length,
    totalPages,
    hasNext: page + 1 < totalPages,
  }
}
