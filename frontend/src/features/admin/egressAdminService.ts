import { apiClient } from '@/shared/api/client'

/** 진행 중 Egress 한 건(관리 콘솔 표시용). 백엔드 EgressControl.ActiveEgress와 대응. */
export interface ActiveEgress {
  egressId: string
  roomName: string
  state: string
  startedAtMs: number
}

/** 서버 전체의 진행 중(STARTING/ACTIVE) Egress 목록. ADMIN 전용(/api/admin/**). */
export async function getActiveEgresses(): Promise<ActiveEgress[]> {
  const { data } = await apiClient.get<ActiveEgress[]>('/admin/egress')
  return data
}

/** 지정 Egress 강제 정지(멱등). */
export async function stopEgress(egressId: string): Promise<void> {
  await apiClient.post(`/admin/egress/${egressId}/stop`)
}
