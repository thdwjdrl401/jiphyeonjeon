/**
 * 강의 자료의 준비 상태를 화면에 옮기는 규칙 한 곳.
 *
 * 서버는 자료마다 서로 **직교하는 두 상태**를 준다(CONTRACT §2).
 * - `embeddingStatus` — pgvector 적재. `PENDING→PROCESSING→READY|FAILED` (ADR-0036)
 * - `keyTermStatus`   — PPTX 핵심 용어 추출. 임베딩 성공 여부와 무관하게 따로 움직인다 (choinhoo/0010)
 *
 * 이 파일이 생긴 이유: 같은 규칙이 화면마다 제각각이었다. 녹화강의 상세만 서버 상태를 읽고,
 * 강의 폼·커리큘럼 자료 필드는 "로컬에 File이 있나"로 배지를 만들어 **저장된 자료는 실제 상태와
 * 무관하게 늘 READY로** 보였다. 라벨·색·폴링 여부를 여기서만 정한다.
 */

/** 아직 서버에 올리지 않은 로컬 선택 파일. 서버 상태가 존재하지 않는 구간이라 따로 부른다. */
export const UPLOAD_PENDING = 'UPLOAD_PENDING'

export type MaterialWorkState =
  | typeof UPLOAD_PENDING
  | 'PENDING'
  | 'PROCESSING'
  | 'READY'
  | 'FAILED'

/**
 * 상태를 읽을 수 있는 최소 모양. 레슨 자료(`LessonMaterialView`)와 커리큘럼 자료
 * (`CurriculumMaterial`)가 필드 이름이 조금 다른 채로 공존해서, 둘 다 그대로 받는다.
 */
export interface MaterialStatusSource {
  embeddingStatus?: string
  keyTermStatus?: string
  /** 레슨 자료 응답의 호환 필드. `httpLessonService`가 embeddingStatus와 같은 값을 넣는다. */
  status?: string
  /** 폼에서 방금 고른 원본 파일. 있으면 아직 업로드 전이다. */
  file?: File
}

/** 사용자를 기다리게 하는 상태. 이 값이 하나라도 있으면 화면을 다시 읽어야 한다. */
const IN_PROGRESS = new Set([UPLOAD_PENDING, 'PENDING', 'PROCESSING'])

/**
 * 자료 목록을 다시 읽는 주기. ADR-0036이 정한 값이다.
 *
 * 임베딩이 수 초~수십 초라 3초면 체감 지연이 처리 시간에 묻힌다. 푸시 채널을 새로 파는 값어치가
 * 없다고 본 판단이고, 아래 `materialRefetchInterval`이 **끝나면 스스로 멈추기** 때문에 상시 부하도 아니다.
 */
export const MATERIAL_POLL_INTERVAL_MS = 3_000

export function materialEmbeddingState(material: MaterialStatusSource): MaterialWorkState {
  if (material.file) return UPLOAD_PENDING
  // 서버가 값을 안 줬으면 READY로 본다 — 파이프라인 도입 이전에 붙은 자료이거나 스위치가 꺼진
  // 환경이다(V6 마이그레이션이 기존 행을 READY로 승계한 것과 같은 이유). 모르는 걸 "처리 중"으로
  // 칠하면 영원히 도는 폴링이 된다.
  return (material.embeddingStatus ?? material.status ?? 'READY') as MaterialWorkState
}

export function isMaterialInProgress(material: MaterialStatusSource): boolean {
  return IN_PROGRESS.has(materialEmbeddingState(material))
    || IN_PROGRESS.has(material.keyTermStatus ?? 'NOT_REQUESTED')
}

export function hasMaterialInProgress(materials: readonly MaterialStatusSource[]): boolean {
  return materials.some(isMaterialInProgress)
}

/**
 * react-query `refetchInterval`에 그대로 넣는 값.
 *
 * 진행 중인 자료가 없으면 `false`를 돌려 **폴링을 끈다**. 화면을 열어 두기만 해도 3초마다 요청이
 * 나가는 상태로 굳지 않게 하는 게 핵심이다. 호출부는 `refetchIntervalInBackground: false`를 함께
 * 줘서 숨은 탭에서도 멈추게 한다.
 */
export function materialRefetchInterval(
  materials: readonly MaterialStatusSource[] | undefined,
): number | false {
  return hasMaterialInProgress(materials ?? []) ? MATERIAL_POLL_INTERVAL_MS : false
}

export type MaterialBadgeTone = 'neutral' | 'success' | 'warning' | 'danger'

export interface MaterialBadge {
  /**
   * 배지에 찍히는 글자. <b>짧게 유지한다</b> — 자료 목록의 행은 파일명·다운로드·제거 버튼과 자리를
   * 나눠 쓰는 좁은 줄이고, 배지가 두 개 붙는 경우도 있다. 길어지면 파일명을 밀어내고 행이 무너진다.
   */
  label: string
  /** 짧은 라벨이 못 담는 뜻. 마우스를 올리면 보인다. */
  title: string
  tone: MaterialBadgeTone
  /** 스피너를 돌릴지. 사용자가 기다리면 되는 구간에만 켠다. */
  busy: boolean
}

/**
 * 임베딩 상태 배지.
 *
 * <p>"AI 준비"라고 뭉뚱그리지 않는다 — 예전에 강사가 눌러야 하는 <b>"AI 준비" 버튼</b>이 있었고
 * (지금은 없다. 저장하면 자동으로 시작한다), 그 이름이 남아 있으면 누를 것이 있는 줄 알게 된다.
 *
 * <p>대신 <b>무엇이 되는지</b>를 쓴다. 이 상태가 정하는 것은 딱 하나 — AI 답변이 이 자료를 인용할
 * 수 있는가다(`ai.chunk_embedding` 적재 여부, RAG 검색이 이 테이블을 조인한다). 강의 시작도,
 * 자료 다운로드도, 핵심 용어 추출({@link MaterialStatusSource#keyTermStatus})도 여기에 걸리지 않는다.
 */
function embeddingBadge(state: MaterialWorkState): MaterialBadge {
  switch (state) {
    case UPLOAD_PENDING:
      return {
        label: '저장 대기',
        title: '아직 올리지 않은 파일입니다. 저장하면 업로드와 AI 읽기가 함께 시작됩니다.',
        tone: 'warning', busy: false,
      }
    case 'PENDING':
      return {
        label: '읽기 대기',
        title: 'AI가 곧 이 자료를 읽습니다.',
        tone: 'warning', busy: true,
      }
    case 'PROCESSING':
      return {
        label: '읽는 중',
        title: 'AI가 이 자료를 읽고 있습니다. 끝나면 답변에 인용됩니다.',
        tone: 'warning', busy: true,
      }
    case 'FAILED':
      return {
        label: '읽기 실패',
        title: 'AI가 이 자료를 읽지 못했습니다. 답변에 인용되지 않습니다.',
        tone: 'danger', busy: false,
      }
    default:
      return {
        label: 'AI 반영됨',
        title: 'AI 답변이 이 자료를 인용할 수 있습니다.',
        tone: 'success', busy: false,
      }
  }
}

function keyTermBadge(status: string): MaterialBadge | null {
  switch (status) {
    case 'PENDING':
      return { label: '용어 대기', title: '핵심 용어 추출을 기다리고 있습니다.', tone: 'warning', busy: true }
    case 'PROCESSING':
      return { label: '용어 추출', title: 'PPTX에서 핵심 용어를 뽑고 있습니다.', tone: 'warning', busy: true }
    case 'READY':
      return { label: '용어 완료', title: '핵심 용어를 뽑았습니다. 용어집에서 확인·수정할 수 있습니다.', tone: 'success', busy: false }
    case 'EMPTY':
      return { label: '용어 없음', title: '뽑을 만한 핵심 용어가 없었습니다.', tone: 'neutral', busy: false }
    case 'FAILED':
      return { label: '용어 실패', title: '핵심 용어를 뽑지 못했습니다. 용어집에 직접 추가할 수 있습니다.', tone: 'danger', busy: false }
    default:
      // NOT_REQUESTED. 배지를 만들지 않는다 — 요청한 적 없는 작업의 "안 함"은 정보가 아니라 소음이다.
      return null
  }
}

/**
 * 강사에게 보이는 배지들. 임베딩은 늘 한 개, 용어 추출은 요청된 자료에만 붙는다.
 *
 * 강사는 이 자료로 AI가 답할 수 있는지를 판단해야 하므로 실패도 그대로 보여 준다 — 감추면
 * "왜 AI가 이 자료를 모르지"를 알 방법이 없어진다.
 */
export function instructorMaterialBadges(material: MaterialStatusSource): MaterialBadge[] {
  const badges = [embeddingBadge(materialEmbeddingState(material))]
  const keyTerm = keyTermBadge(material.keyTermStatus ?? 'NOT_REQUESTED')
  if (keyTerm) badges.push(keyTerm)
  return badges
}

/**
 * 수강생에게 보이는 배지. 준비가 끝났으면 `null`(아무것도 그리지 않는다).
 *
 * 파이프라인 내부 상태를 그대로 노출하지 않는다. 수강생이 할 수 있는 일은 기다리는 것뿐이라
 * PENDING과 PROCESSING을 구분해 봤자 의미가 없고, FAILED도 "실패"가 아니라 강사가 손봐야 할
 * 상태로 읽히는 게 맞다. 다운로드 자체는 임베딩과 무관하게 언제나 된다 — 원본 파일은 이미 있다.
 */
export function studentMaterialBadge(material: MaterialStatusSource): MaterialBadge | null {
  const state = materialEmbeddingState(material)
  if (state === 'READY') return null
  if (state === 'FAILED') {
    return { label: '미반영', title: '이 자료는 AI 답변에 인용되지 않습니다.', tone: 'neutral', busy: false }
  }
  return { label: '준비 중', title: 'AI가 이 자료를 읽고 있습니다.', tone: 'warning', busy: true }
}
