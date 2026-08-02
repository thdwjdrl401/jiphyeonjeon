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
