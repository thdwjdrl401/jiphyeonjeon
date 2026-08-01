import { useMutation, useQuery } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { getActiveEgresses, stopEgress, type ActiveEgress } from '@/features/admin/egressAdminService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { useToast } from '@/shared/ui/Toast'
import { InlineNotice, PageHeader, Panel } from '@/shared/ui/WorkspaceUi'

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

  const stop = useMutation({
    mutationFn: (egressId: string) => stopEgress(egressId),
    onSuccess: () => {
      toast.success('Egress를 정지했습니다.')
      void query.refetch()
    },
    onError: () => toast.error('정지에 실패했습니다.'),
  })

  const stopAll = async () => {
    const list = query.data ?? []
    for (const e of list) {
      await stopEgress(e.egressId).catch(() => undefined)
    }
    toast.success('진행 중 Egress를 모두 정지 요청했습니다.')
    void query.refetch()
  }

  const forbidden = query.error instanceof ApiError && query.error.status === 403
  const rows: ActiveEgress[] = query.data ?? []

  return (
    <div className="workspace-page">
      <PageHeader title="Egress 관리 콘솔" description="진행 중인 녹화(Egress)를 확인하고 강제로 정지합니다." />

      {forbidden ? (
        <InlineNotice tone="danger">관리자(ADMIN) 권한이 필요합니다.</InlineNotice>
      ) : (
        <Panel>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
              새로고침
            </button>
            <button type="button" onClick={() => void stopAll()} disabled={rows.length === 0}>
              전부 정지
            </button>
            <span style={{ marginLeft: 'auto', color: 'var(--text-muted, #888)' }}>
              진행 중 {rows.length}건 {query.isFetching ? '· 갱신 중…' : ''}
            </span>
          </div>

          {query.isError && !forbidden && (
            <InlineNotice tone="danger">목록을 불러오지 못했습니다.</InlineNotice>
          )}

          {rows.length === 0 ? (
            <p style={{ color: 'var(--text-muted, #888)' }}>진행 중인 Egress가 없습니다.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: '6px 8px' }}>방(room)</th>
                    <th style={{ padding: '6px 8px' }}>상태</th>
                    <th style={{ padding: '6px 8px' }}>시작</th>
                    <th style={{ padding: '6px 8px' }}>egressId</th>
                    <th style={{ padding: '6px 8px' }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => (
                    <tr key={e.egressId} style={{ borderTop: '1px solid var(--border, #333)' }}>
                      <td style={{ padding: '6px 8px' }}>{e.roomName || '-'}</td>
                      <td style={{ padding: '6px 8px' }}>{e.state}</td>
                      <td style={{ padding: '6px 8px' }}>{formatStartedAt(e.startedAtMs)}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: '0.85em' }}>
                        {e.egressId}
                      </td>
                      <td style={{ padding: '6px 8px' }}>
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
