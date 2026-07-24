export type LearningPanel = 'discussion' | 'notes' | 'ai' | 'glossary'

export interface LiveSummaryConcept {
  name: string
  description: string
}

export interface LiveSummaryBlock {
  summaryBlockId: string
  startMs: number
  endMs: number
  title: string
  keyPoints: string[]
  concepts: LiveSummaryConcept[]
  emphasis: string[]
  examples: string[]
  createdAtLabel: string
}

export interface GlossaryTermView {
  termId: string
  term: string
  description: string
  source: 'INSTRUCTOR' | 'MATERIAL'
  sourceLabel: string
  aliases: string[]
  occurrenceCount: number
}

const summaryBlocks: LiveSummaryBlock[] = [
  {
    summaryBlockId: 'summary-001',
    startMs: 0,
    endMs: 270_000,
    title: '요청이 인증되는 전체 흐름',
    keyPoints: [
      'HTTP 요청은 보안 필터 체인을 먼저 통과합니다.',
      '인증 성공 결과는 현재 요청의 보안 컨텍스트에 저장됩니다.',
    ],
    concepts: [
      { name: 'SecurityFilterChain', description: '요청에 순서대로 적용할 보안 필터 묶음입니다.' },
      { name: 'Authentication', description: '현재 사용자의 인증 주체와 권한을 표현합니다.' },
    ],
    emphasis: ['필터의 실행 순서가 인증과 예외 처리 결과를 바꿀 수 있습니다.'],
    examples: ['로그인 요청이 UsernamePasswordAuthenticationFilter를 통과하는 흐름'],
    createdAtLabel: '04:30에 추가',
  },
  {
    summaryBlockId: 'summary-002',
    startMs: 270_000,
    endMs: 540_000,
    title: 'SecurityContext의 책임',
    keyPoints: [
      'SecurityContext는 현재 실행 흐름의 인증 정보를 제공합니다.',
      '서비스 계층은 컨텍스트의 권한을 기준으로 접근을 검사할 수 있습니다.',
    ],
    concepts: [
      { name: 'SecurityContext', description: '현재 요청에서 참조할 Authentication을 보관합니다.' },
      { name: '권한 검사', description: '인증된 사용자가 특정 동작을 수행할 수 있는지 확인합니다.' },
    ],
    emphasis: ['SecurityContext와 장기 저장소인 세션의 책임을 구분해야 합니다.'],
    examples: ['메서드 진입 전 ROLE_INSTRUCTOR 권한을 검사하는 사례'],
    createdAtLabel: '09:00에 추가',
  },
  {
    summaryBlockId: 'summary-003',
    startMs: 540_000,
    endMs: 780_000,
    title: 'Redis로 세션을 공유하는 이유',
    keyPoints: [
      '애플리케이션 서버가 여러 대라면 인증 상태를 외부 저장소에서 공유해야 합니다.',
      '요청의 SecurityContext는 세션에서 복원되고 요청이 끝나면 다시 정리됩니다.',
    ],
    concepts: [
      { name: 'Redis Session', description: '여러 서버가 같은 로그인 상태를 읽도록 돕는 공유 세션 저장소입니다.' },
      { name: 'CSRF', description: '사용자 의도와 무관한 상태 변경 요청을 막기 위한 방어 방식입니다.' },
    ],
    emphasis: ['Redis 장애와 세션 만료 정책은 인증 가용성에 직접 영향을 줍니다.'],
    examples: ['서버 A에서 로그인한 뒤 서버 B로 요청이 분산되는 사례'],
    createdAtLabel: '방금 추가',
  },
]

const glossaryTerms: GlossaryTermView[] = [
  {
    termId: 'term-security-context',
    term: 'SecurityContext',
    description: '현재 실행 중인 요청에서 인증된 사용자와 권한 정보인 Authentication을 보관하는 컨테이너입니다.',
    source: 'INSTRUCTOR',
    sourceLabel: '강사 등록',
    aliases: ['보안 컨텍스트'],
    occurrenceCount: 8,
  },
  {
    termId: 'term-security-filter-chain',
    term: 'SecurityFilterChain',
    description: 'HTTP 요청에 적용되는 Spring Security 필터의 순서와 적용 조건을 정의합니다.',
    source: 'MATERIAL',
    sourceLabel: '강의 자료에서 추출',
    aliases: ['보안 필터 체인'],
    occurrenceCount: 6,
  },
  {
    termId: 'term-redis',
    term: 'Redis',
    description: '세션과 캐시처럼 빠르게 접근해야 하는 데이터를 메모리 중심으로 저장하는 데이터 저장소입니다.',
    source: 'INSTRUCTOR',
    sourceLabel: '강사 등록',
    aliases: ['Redis Session'],
    occurrenceCount: 11,
  },
  {
    termId: 'term-csrf',
    term: 'CSRF',
    description: '로그인된 사용자의 권한을 악용해 의도하지 않은 상태 변경 요청을 보내는 공격과 그 방어 기법입니다.',
    source: 'MATERIAL',
    sourceLabel: '강의 자료에서 추출',
    aliases: ['Cross-Site Request Forgery'],
    occurrenceCount: 5,
  },
]

/**
 * API·WS 계약 확정 전 라이브 학습 UI를 검증하기 위한 preview 데이터 경계다.
 * 실제 연결 단계에서는 이 함수 호출만 Query/실시간 store 입력으로 교체한다.
 */
export function getLiveLearningPreview() {
  return { summaryBlocks, glossaryTerms }
}
