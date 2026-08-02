import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { adminPaths } from '@/app/router/paths'
import { getActiveEgresses, getRecordingSummary, reconcileRecordings } from '@/features/admin/adminService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { useToast } from '@/shared/ui/Toast'
import { InlineNotice, PageHeader, Panel } from '@/shared/ui/WorkspaceUi'

/** 정체 판단 기준. 녹화 완료는 보통 분 단위라, 1시간을 넘겼으면 사람이 봐야 한다. */
const FINALIZING_STALE_MS = 60 * 60 * 1000

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return '-'
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms % 3_600_000) / 60_000)
  return hours > 0 ? `${hours}시간 ${minutes}분` : `${minutes}분`
}

interface SignalProps {
  label: string
  value: string | number
  hint?: string
  tone?: 'normal' | 'warning' | 'danger'
}

function Signal({ label, value, hint, tone = 'normal' }: SignalProps) {
  const toneClass = tone === 'danger' ? ' is-danger' : tone === 'warning' ? ' is-warning' : ''
  return (
    <div className={`admin-signal${toneClass}`}>
      <span className="admin-signal__label">{label}</span>
      <strong className="admin-signal__value">{value}</strong>
      {hint && <span className="admin-signal__hint">{hint}</span>}
    </div>
  )
}

/**
 * 운영 현황 한 화면.
 *
 * <p>여기 올리는 것은 "많은 지표"가 아니라 <b>사람이 손대야 하는 신호</b>다. 지금까지 놓쳤던 것들이
 * 기준이다 — 녹화가 하나도 완료되지 않고 있었고(완료 webhook 미설정), Egress 슬롯이 유령에 물려
 * 새 녹화가 막혔다. 둘 다 화면에는 "처리 중"으로만 보여 정상과 구분되지 않았다.
 */
export default function AdminOverviewPage() {
  usePageTitle('운영 현황')

  const egressQuery = useQuery({
    queryKey: ['admin-egress'],
    queryFn: getActiveEgresses,
    refetchInterval: 10_000,
  })
  const recordingsQuery = useQuery({
    queryKey: ['admin-recordings-summary'],
    queryFn: getRecordingSummary,
    refetchInterval: 30_000,
  })

  const toast = useToast()
  const reconcile = useMutation({
    mutationFn: reconcileRecordings,
    onSuccess: () => {
      void recordingsQuery.refetch()
      void egressQuery.refetch()
    },
    onError: () => toast.error('녹화 확정에 실패했습니다.'),
  })

  // 상태를 되돌릴 수 없는 조작이라 한 번 묻는다. 진행 중인 녹화는 대상이 아니라는 것도 함께 알린다.
  const runReconcile = () => {
    const ok = window.confirm(
      '멈춘 녹화를 LiveKit 결과로 확정합니다.\n완료/실패가 확정되면 되돌릴 수 없습니다. 진행하시겠습니까?',
    )
    if (ok) reconcile.mutate()
  }

  const activeEgress = egressQuery.data?.length ?? 0
  const byStatus = recordingsQuery.data?.byStatus ?? []
  const countOf = (status: string) => byStatus.find((s) => s.status === status)?.count ?? 0
  const ready = countOf('READY')
  const finalizing = countOf('FINALIZING')
  const failed = countOf('FAILED')
  const totalAssets = byStatus.reduce((sum, s) => sum + s.count, 0)

  const oldest = recordingsQuery.data?.oldestFinalizingAt ?? null
  const oldestStale = oldest ? Date.now() - new Date(oldest).getTime() > FINALIZING_STALE_MS : false

  // 녹화가 한 건이라도 있는데 READY가 0이면 완료 경로 자체가 끊긴 것이다(webhook 미수신 등).
  const completionBroken = totalAssets > 0 && ready === 0

  return (
    <div>
      <PageHeader title="운영 현황" description="사람이 손대야 하는 신호만 모았습니다." />

      {completionBroken && (
        <InlineNotice tone="danger">
          녹화 자산이 {totalAssets}건 있는데 <strong>완료(READY)가 0건</strong>입니다. 완료 확정이
          이뤄지지 않고 있습니다 — LiveKit egress 완료 webhook이 서버에 닿는지 확인이 필요합니다.
        </InlineNotice>
      )}

      <Panel title="녹화">
        <div className="admin-signals">
          <Signal
            label="진행 중 Egress"
            value={egressQuery.isError ? '-' : activeEgress}
            hint={activeEgress > 0 ? '전역 슬롯을 점유합니다' : '없음'}
            tone={activeEgress > 0 ? 'warning' : 'normal'}
          />
          <Signal label="완료(READY)" value={ready} tone={completionBroken ? 'danger' : 'normal'} />
          <Signal
            label="처리 중(FINALIZING)"
            value={finalizing}
            hint={oldest ? `가장 오래된 건 ${formatAge(oldest)} 경과` : undefined}
            tone={oldestStale ? 'danger' : finalizing > 0 ? 'warning' : 'normal'}
          />
          <Signal label="실패(FAILED)" value={failed} tone={failed > 0 ? 'warning' : 'normal'} />
        </div>
        {egressQuery.isError && <InlineNotice tone="danger">Egress 목록을 불러오지 못했습니다.</InlineNotice>}
        {recordingsQuery.isError && <InlineNotice tone="danger">녹화 현황을 불러오지 못했습니다.</InlineNotice>}

        {finalizing > 0 && (
          <div className="admin-toolbar" style={{ marginTop: 12 }}>
            <button type="button" disabled={reconcile.isPending} onClick={runReconcile}>
              {reconcile.isPending ? '확인 중…' : '멈춘 녹화 확정하기'}
            </button>
            <span className="admin-toolbar__spacer">
              LiveKit에 결과를 물어 완료/실패로 확정합니다. 진행 중인 녹화는 건드리지 않습니다.
            </span>
          </div>
        )}
        {reconcile.data && (
          <InlineNotice tone={reconcile.data.completed > 0 ? 'success' : 'info'}>
            {reconcile.data.checked}건 확인 · 완료 {reconcile.data.completed} · 실패 {reconcile.data.failed}
            {reconcile.data.stillRunning > 0 && ` · 진행 중 ${reconcile.data.stillRunning}`}
            {reconcile.data.unknown > 0 && ` · 미확인 ${reconcile.data.unknown}`}
            {reconcile.data.unknown > 0 && ' (LiveKit이 모르는 작업은 단정하지 않고 그대로 뒀습니다)'}
          </InlineNotice>
        )}

        <p style={{ marginTop: 12 }}>
          <Link to={adminPaths.egress}>진행 중 Egress 관리 →</Link>
        </p>
      </Panel>
    </div>
  )
}
