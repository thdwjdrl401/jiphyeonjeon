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

/** 지정 Egress 강제 정지(멱등). */
export async function stopEgress(egressId: string): Promise<void> {
  await apiClient.post(`/admin/egress/${egressId}/stop`)
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
