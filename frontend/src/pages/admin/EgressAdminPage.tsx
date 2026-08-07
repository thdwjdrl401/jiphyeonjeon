import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiError } from '@/shared/api/client'
import {
  getActiveEgresses, purgeEgress, sessionIdFromRoomName, stopEgress, type ActiveEgress,
} from '@/features/admin/adminService'
import SessionLabelCell, { useSessionLabels } from '@/features/admin/SessionLabelCell'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { useToast } from '@/shared/ui/Toast'
import { InlineNotice, PageHeader, Panel } from '@/shared/ui/WorkspaceUi'

/**
 * 유령 Egress 안내. 버튼을 다시 눌러도 결과가 같으므로, 무엇이 일어났고 다음에 무엇을 해야 하는지까지 말한다.
 * (녹화 도중 egress 컨테이너가 재시작되면 그 작업을 소유한 핸들러가 완료 보고 없이 사라진다. LiveKit은
 * 작업을 계속 진행 중으로 들고 있지만 정지 요청을 받아 줄 상대가 없고, 고아를 회수하는 API도 없다.)
 */
const ORPHAN_MESSAGE
  = '소유 노드가 사라져 LiveKit이 정지시킬 수 없습니다(유령). 다시 눌러도 같으니 수동 정리가 필요합니다.'

function formatStartedAt(ms: number): string {
  if (!ms) return '-'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return String(ms)
  }
}

/**
 * Egress 운영 콘솔 — 서버 전체의 진행 중 Egress를 보고 강제 정지한다.
 * "유령 Egress"(끝난 방에 남아 전역 슬롯을 막는 것)를 즉시 걷어내는 도구. ADMIN 전용(백엔드가 게이팅).
 */
export default function EgressAdminPage() {
  usePageTitle('Egress 관리')
  const toast = useToast()

  const query = useQuery({
    queryKey: ['admin-egress'],
    queryFn: getActiveEgresses,
    refetchInterval: 5000,
  })

  // 정지를 시도해 유령으로 판명된 것들. 목록만 봐서는 알 수 없고 눌러 봐야 드러난다.
  const [orphanIds, setOrphanIds] = useState<string[]>([])
  const rememberOrphan = (egressId: string) =>
    setOrphanIds(prev => (prev.includes(egressId) ? prev : [...prev, egressId]))

  const stop = useMutation({
    mutationFn: (egressId: string) => stopEgress(egressId),
    onSuccess: (result, egressId) => {
      if (result.outcome === 'ORPHANED') {
        rememberOrphan(egressId)
        toast.error(ORPHAN_MESSAGE)
      }
      else if (result.outcome === 'ALREADY_ENDED') toast.success('이미 종료된 Egress였습니다.')
      else toast.success('Egress를 정지했습니다.')
      void query.refetch()
    },
    // 여기까지 오는 것은 LiveKit 통신·서버 오류뿐이다. "정지되지 않음"은 결말로 내려온다.
    onError: () => toast.error('LiveKit에 정지를 요청하지 못했습니다.'),
  })

  /**
   * 전부 정지. <b>결과를 세어 보고한다.</b> 전에는 실패를 통째로 삼키고 언제나 "모두 정지 요청했습니다"라고
   * 알려, 유령이 하나도 안 걷혔는데도 성공으로 보였다.
   */
  const stopAll = async () => {
    const list = query.data ?? []
    let stopped = 0
    let orphaned = 0
    let failed = 0
    for (const e of list) {
      try {
        const { outcome } = await stopEgress(e.egressId)
        if (outcome === 'ORPHANED') {
          orphaned += 1
          rememberOrphan(e.egressId)
        }
        else stopped += 1
      } catch {
        failed += 1
      }
    }
    const parts = [`정지 ${stopped}건`]
    if (orphaned > 0) parts.push(`유령 ${orphaned}건`)
    if (failed > 0) parts.push(`요청 실패 ${failed}건`)
    const summary = parts.join(' · ')
    if (orphaned > 0 || failed > 0) toast.error(summary)
    else toast.success(summary)
    void query.refetch()
  }

  /**
   * 유령 회수. 서버가 지우기 전에 유령임을 다시 확인하므로, 그 사이에 상황이 바뀌어 유령이 아니게
   * 됐다면 {@code purged: false}로 돌아온다 — 그것도 사실대로 알린다.
   */
  const purge = useMutation({
    mutationFn: (egressId: string) => purgeEgress(egressId),
  })

  const purgeAll = async () => {
    let removed = 0
    let kept = 0
    let failed = 0
    for (const egressId of orphanIds) {
      try {
        const { purged } = await purge.mutateAsync(egressId)
        if (purged) removed += 1
        else kept += 1
      } catch {
        failed += 1
      }
    }
    setOrphanIds(prev => (removed > 0 && kept === 0 && failed === 0 ? [] : prev))
    const parts = [`제거 ${removed}건`]
    if (kept > 0) parts.push(`유령이 아니어서 보존 ${kept}건`)
    if (failed > 0) parts.push(`실패 ${failed}건`)
    const summary = parts.join(' · ')
    if (kept > 0 || failed > 0) toast.error(summary)
    else toast.success(summary)
    void query.refetch()
  }

  const forbidden = query.error instanceof ApiError && query.error.status === 403
  const rows: ActiveEgress[] = query.data ?? []
  /*
   * 방 이름(session-{id})에서 세션 id를 꺼내 이름표를 한 번에 받아 온다.
   * 세션이 이미 지워진 유령 건은 이름이 비어 오지만 행은 그대로 남는다 — 정지·정리 버튼이 필요한
   * 것이 정확히 그런 행이다.
   */
  const labels = useSessionLabels(rows.map((e) => sessionIdFromRoomName(e.roomName)))

  return (
    <div>
      <PageHeader title="Egress 관리" description="진행 중인 녹화(Egress)를 확인하고 강제로 정지합니다." />

      {forbidden ? (
        <InlineNotice tone="danger">관리자(ADMIN) 권한이 필요합니다.</InlineNotice>
      ) : (
        <Panel>
          <div className="admin-toolbar">
            <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
              새로고침
            </button>
            <button type="button" onClick={() => void stopAll()} disabled={rows.length === 0}>
              전부 정지
            </button>
            <span className="admin-toolbar__spacer">
              진행 중 {rows.length}건 {query.isFetching ? '· 갱신 중…' : ''}
            </span>
          </div>

          {query.isError && !forbidden && (
            <InlineNotice tone="danger">목록을 불러오지 못했습니다.</InlineNotice>
          )}

          {orphanIds.length > 0 && (
            <InlineNotice tone="danger">
              <p>
                <strong>유령 Egress {orphanIds.length}건</strong> — 소유 노드가 사라져 정지로는 걷히지
                않습니다. 아래에서 기록을 지우세요. 지우기 전에 서버와 회수 중계가 각각 유령임을 다시
                확인하므로, 살아 있는 녹화는 지워지지 않습니다.
              </p>
              <div className="admin-toolbar">
                <button type="button" onClick={() => void purgeAll()} disabled={purge.isPending}>
                  {purge.isPending ? '제거 중…' : `유령 ${orphanIds.length}건 제거`}
                </button>
                <span className="admin-toolbar__spacer is-mono">{orphanIds.join(' · ')}</span>
              </div>
            </InlineNotice>
          )}

          {rows.length === 0 ? (
            <p style={{ color: 'var(--text-muted, #888)' }}>진행 중인 Egress가 없습니다.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>강의</th>
                    <th>상태</th>
                    <th>시작</th>
                    <th>egressId</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.egressId}>
                      <td>
                        <SessionLabelCell
                          sessionId={sessionIdFromRoomName(e.roomName)}
                          label={labels.get(sessionIdFromRoomName(e.roomName) ?? '')}
                        />
                      </td>
                      <td>{e.state}</td>
                      <td>{formatStartedAt(e.startedAtMs)}</td>
                      <td className="is-mono">{e.egressId}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => stop.mutate(e.egressId)}
                          disabled={stop.isPending}
                        >
                          정지
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}
    </div>
  )
}
