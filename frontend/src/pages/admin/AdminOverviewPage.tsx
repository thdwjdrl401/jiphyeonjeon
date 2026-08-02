import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { adminPaths } from '@/app/router/paths'
import { getActiveEgresses, getLiveSummary, getRecordingSummary, reconcileRecordings } from '@/features/admin/adminService'
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
  const liveQuery = useQuery({
    queryKey: ['admin-live-summary'],
    queryFn: getLiveSummary,
    refetchInterval: 15_000,
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

  // 되돌릴 수 없는 데다 결과가 수강생에게 바로 보이는 조작이라, 무엇이 일어나는지 다 적고 묻는다.
  // 확정은 webhook과 같은 경로를 타는데 그 경로가 정상 녹화를 자동 게시한다(choinhoo/0007) —
  // "완료 처리"로만 안내하면 게시까지 되는 줄 모르고 누르게 된다.
  const runReconcile = () => {
    const ok = window.confirm(
      '멈춘 녹화를 LiveKit 결과로 확정합니다.\n\n'
        + '· 완료된 녹화는 다시보기로 자동 게시되어 수강생에게 바로 보입니다.\n'
        + '· 실패한 녹화는 실패로 확정됩니다.\n'
        + '· 진행 중이거나 확인할 수 없는 건은 건드리지 않습니다.\n\n'
        + '확정 후에는 되돌릴 수 없습니다. 진행하시겠습니까?',
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

  // --- 라이브 ---
  const liveByStatus = liveQuery.data?.byStatus ?? []
  const liveCountOf = (status: string) => liveByStatus.find((s) => s.status === status)?.count ?? 0
  const inProgress = liveCountOf('STARTING') + liveCountOf('LIVE') + liveCountOf('ENDING')
  const stuck = liveQuery.data?.stuck ?? []
  const stuckAfterHours = liveQuery.data?.stuckAfterHours ?? 0

  // 자막은 "숫자 하나"로 읽히지 않는다 — 꺼져 있는 것/한 번도 안 돈 것/밀린 것이 다 다르다.
  // 그 셋을 구분해 보여 주지 않으면 정상인데 고장으로, 고장인데 정상으로 읽힌다.
  const caption = ((): { value: string; hint?: string; tone: 'normal' | 'warning' | 'danger' } => {
    const cs = liveQuery.data?.captionStream
    if (!cs) return { value: '-', tone: 'normal' }
    if (!cs.enabled) return { value: '꺼짐', hint: '이 배포에서 자막 소비가 비활성', tone: 'normal' }
    if (cs.length == null) return { value: '알 수 없음', hint: 'Redis 조회 실패', tone: 'warning' }
    if (!cs.groupExists) {
      return { value: '대기', hint: '아직 소비를 시작하지 않음(강의 후 생성)', tone: 'normal' }
    }
    const pending = cs.pending ?? 0
    return {
      value: pending === 0 ? '정상' : `밀림 ${pending}`,
      hint: `스트림 ${cs.length}건 · 미처리 ${pending}건`,
      tone: pending > 0 ? 'warning' : 'normal',
    }
  })()

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
              LiveKit에 결과를 물어 확정합니다. 완료된 녹화는 다시보기로 자동 게시됩니다.
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

      <Panel title="라이브">
        <div className="admin-signals">
          <Signal
            label="진행 중 세션"
            value={liveQuery.isError ? '-' : inProgress}
            hint={stuck.length > 0 ? `${stuckAfterHours}시간 넘게 안 끝난 세션 ${stuck.length}건` : undefined}
            tone={stuck.length > 0 ? 'danger' : 'normal'}
          />
          <Signal label="자막 소비" value={caption.value} hint={caption.hint} tone={caption.tone} />
        </div>
        {liveQuery.isError && <InlineNotice tone="danger">라이브 현황을 불러오지 못했습니다.</InlineNotice>}

        {stuck.length > 0 && (
          <>
            <InlineNotice tone="danger">
              끝나지 않은 세션이 있습니다. 그 방과 Egress가 계속 살아 있어{' '}
              <strong>다음 강의의 녹화를 막을 수 있습니다.</strong>
            </InlineNotice>
            <div style={{ overflowX: 'auto' }}>
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>세션</th>
                    <th>상태</th>
                    <th>시작</th>
                    <th>경과</th>
                  </tr>
                </thead>
                <tbody>
                  {stuck.map((s) => (
                    <tr key={s.sessionId}>
                      <td className="is-mono">{s.sessionId}</td>
                      <td>{s.status}</td>
                      <td>{new Date(s.startedAt).toLocaleString()}</td>
                      <td>{formatAge(s.startedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>
    </div>
  )
}
