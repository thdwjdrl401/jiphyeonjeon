import { apiClient } from '@/shared/api/client'

/** 진행 중 Egress 한 건. 백엔드 `EgressControl.ActiveEgress`와 대응. */
export interface ActiveEgress {
  egressId: string
  roomName: string
  state: string
  startedAtMs: number
}

export interface StatusCount {
  status: string
  count: number
}

export interface RecordingSummary {
  byStatus: StatusCount[]
  /** 가장 오래 FINALIZING인 자산의 생성 시각(ISO). 없으면 null. */
  oldestFinalizingAt: string | null
}

/** 서버 전체의 진행 중(STARTING/ACTIVE) Egress 목록. ADMIN 전용. */
export async function getActiveEgresses(): Promise<ActiveEgress[]> {
  const { data } = await apiClient.get<ActiveEgress[]>('/admin/egress')
  return data
}

/**
 * 정지 요청의 결말. 백엔드 `EgressControl.StopOutcome`과 대응.
 *
 * - `STOPPED` 정지 요청이 받아들여졌다
 * - `ALREADY_ENDED` 이미 끝난 작업이라 할 일이 없었다(멱등)
 * - `ORPHANED` 소유 노드가 사라져 이 경로로는 정지할 수 없다 — 사람이 정리해야 한다
 */
export type StopOutcome = 'STOPPED' | 'ALREADY_ENDED' | 'ORPHANED'

export interface StopEgressResult {
  outcome: StopOutcome
}

/** 지정 Egress 강제 정지(멱등). 정지되지 않는 경우도 오류가 아니라 결말로 돌아온다. */
export async function stopEgress(egressId: string): Promise<StopEgressResult> {
  const { data } = await apiClient.post<StopEgressResult>(`/admin/egress/${egressId}/stop`)
  return data
}

export interface PurgeEgressResult {
  /** 실제로 기록을 지웠는가. false면 유령이 아니어서 지우지 않은 것이다. */
  purged: boolean
  /** 지우기 전에 확인한 정지 결말 — 지우지 않았다면 그 이유가 여기 있다. */
  outcome: StopOutcome
}

/**
 * 유령 Egress 회수 — LiveKit이 정지시킬 수 없는 기록을 걷어낸다.
 *
 * 서버가 지우기 전에 유령임을 확인하고, 호스트의 회수 중계도 한 번 더 확인한다.
 * 그래서 살아 있는 녹화에 잘못 눌러도 지워지지 않는다(`purged: false`로 돌아온다).
 */
export async function purgeEgress(egressId: string): Promise<PurgeEgressResult> {
  const { data } = await apiClient.post<PurgeEgressResult>(`/admin/egress/${egressId}/purge`)
  return data
}

/** 녹화 자산 상태 분포 + 가장 오래 멈춘 자산. */
export async function getRecordingSummary(): Promise<RecordingSummary> {
  const { data } = await apiClient.get<RecordingSummary>('/admin/recordings/summary')
  return data
}

export interface StuckSession {
  sessionId: string
  status: string
  startedAt: string
}

export interface CaptionStreamState {
  streamKey: string
  group: string
  /** 이 배포에서 자막 소비가 켜져 있는가. 꺼져 있으면 pending이 쌓여도 정상이다. */
  enabled: boolean
  /** 소비 그룹이 만들어졌는가. 한 번도 소비하지 않았으면 없다. */
  groupExists: boolean
  /** 스트림 엔트리 수. 조회 실패면 null. */
  length: number | null
  /** 소비 그룹 미처리 수. 조회 실패면 null. */
  pending: number | null
}

export interface LiveSummary {
  byStatus: StatusCount[]
  stuck: StuckSession[]
  /** 갇힘 판정에 쓴 기준 시간. 화면이 같은 기준으로 설명하도록 서버가 함께 준다. */
  stuckAfterHours: number
  captionStream: CaptionStreamState
}

/** 라이브 세션 상태 분포 + 갇힌 세션 + 자막 소비 상태. */
export async function getLiveSummary(): Promise<LiveSummary> {
  const { data } = await apiClient.get<LiveSummary>('/admin/live/summary')
  return data
}

/**
 * 세션 하나의 사람이 읽는 이름표. 백엔드 `SessionLabelService.SessionLabel`과 대응.
 *
 * <p>못 찾은 세션도 `sessionId`만 채워 함께 온다 — 화면이 행을 짝지어야 하고, 유령 Egress처럼
 * 세션이 이미 사라진 건이 실제로 있다.
 */
export interface SessionLabel {
  sessionId: string
  lessonId: string | null
  lessonTitle: string | null
  curriculumId: string | null
  curriculumTitle: string | null
}

/**
 * 세션 id를 강의·커리큘럼 제목으로 바꾼다. 표를 그리면서 필요한 id를 모아 <b>한 번에</b> 물어본다 —
 * 행마다 부르면 행 수만큼 왕복이 생긴다.
 *
 * <p>조회지만 POST다. id 여러 개를 쿼리스트링에 늘어놓으면 URL 길이 상한에 걸린다.
 */
export async function getSessionLabels(sessionIds: string[]): Promise<SessionLabel[]> {
  if (sessionIds.length === 0) return []
  const { data } = await apiClient.post<SessionLabel[]>('/admin/session-labels', { sessionIds })
  return data
}

/** 세션이 무엇을 켜고 시작했는가. "자막이 안 나온다"는 문의에서 제일 먼저 볼 값이다. */
export interface SessionFeatures {
  recording: boolean
  caption: boolean
  chat: boolean
  aiQna: boolean
}

/** 녹화 자산의 기술 상태. 아직 만들어지지 않았거나 녹화를 안 켠 세션이면 `null`이다. */
export interface SessionRecording {
  videoAssetId: string
  status: string
  replayStatus: string | null
  failureCode: string | null
  durationMs: number | null
  sizeBytes: number | null
  startedAt: string | null
  endedAt: string | null
}

/** 세션 하나의 운영 상세. 백엔드 `SessionDetailService.SessionDetail`과 대응. */
export interface SessionDetail {
  sessionId: string
  /** LiveKit 방 이름. 저쪽 콘솔·로그에서 찾을 때 쓰는 값이다. */
  roomName: string
  status: string
  roomSid: string | null
  scheduledAt: string | null
  startedAt: string | null
  endedAt: string | null
  features: SessionFeatures
  lessonId: string | null
  lessonTitle: string | null
  curriculumId: string | null
  curriculumTitle: string | null
  instructorId: string | null
  instructorName: string | null
  recording: SessionRecording | null
}

/** 세션 하나의 운영 상세. 없는 세션은 404다(목록의 이름표와 달리 주소로 직접 들어오는 화면이라). */
export async function getSessionDetail(sessionId: string): Promise<SessionDetail> {
  const { data } = await apiClient.get<SessionDetail>(`/admin/live-sessions/${sessionId}`)
  return data
}

/** Egress `roomName`에서 세션 id를 꺼낸다. 방 이름 규약은 `session-{sessionId}`다(LiveSessionRoomNames). */
export function sessionIdFromRoomName(roomName: string | null | undefined): string | null {
  if (!roomName) return null
  const match = /^session-([0-9a-fA-F-]{36})$/.exec(roomName)
  return match ? match[1] : null
}

/**
 * 지금 라이브 강의실을 열어 둔 사람. 백엔드 `SessionViewerService.LiveViewer`와 대응.
 *
 * <p>LiveKit이 아니라 STOMP 구독으로 센다 — 수강생은 HLS로만 보고 LiveKit 방에 들어오지 않아
 * 저쪽에는 강사·Egress·STT 에이전트만 잡힌다(ADR-0032·0121).
 */
export interface LiveViewer {
  userId: string
  /** 못 찾으면 null. 사용자가 사라져도 행은 남는다 — 이름 하나 때문에 인원이 틀리면 안 된다. */
  displayName: string | null
  instructor: boolean
  /** 들어온 시각(ISO). 탭을 여럿 열었으면 가장 이른 시각이다. */
  since: string
}

/** 방금까지 다시보기를 보고 있던 사람. 백엔드 `SessionViewerService.ReplayViewer`와 대응. */
export interface ReplayViewer {
  userId: string
  displayName: string | null
  /** 마지막으로 보고된 재생 위치 — "어디를 보고 있는가". */
  lastPositionMs: number
  progressPercent: number
  /** 마지막 보고가 서버에 닿은 시각(ISO). 클라이언트 시계가 아니다. */
  lastReportedAt: string
}

export interface SessionViewers {
  sessionId: string
  live: LiveViewer[]
  replay: ReplayViewer[]
  /** 다시보기 판정에 쓴 기준 창(초). 화면이 같은 기준으로 설명하도록 서버가 함께 준다. */
  recentWindowSeconds: number
}

/**
 * 세션 하나의 시청자 현황. 조회 시점의 현황이라 매번 달라진다 — 없는 세션은 404다.
 *
 * <p>상세와 나뉜 이유는 수명이 다르기 때문이다. 접속자는 초 단위로 바뀌어 짧게 폴링하는데, 한
 * 응답에 묶으면 그때마다 강의 제목·녹화 상태까지 다시 조회하게 된다.
 */
export async function getSessionViewers(sessionId: string): Promise<SessionViewers> {
  const { data } = await apiClient.get<SessionViewers>(`/admin/live-sessions/${sessionId}/viewers`)
  return data
}

export interface ReconcileResult {
  checked: number
  completed: number
  failed: number
  stillRunning: number
  unknown: number
}

/**
 * 멈춘 녹화를 LiveKit에 직접 물어 확정한다. 완료 webhook이 끊겨 FINALIZING에 남은 자산의 복구 경로다 —
 * 지나간 webhook은 다시 오지 않아, webhook을 고쳐도 과거 건은 이걸로만 되살릴 수 있다.
 */
export async function reconcileRecordings(): Promise<ReconcileResult> {
  const { data } = await apiClient.post<ReconcileResult>('/admin/recordings/reconcile')
  return data
}
