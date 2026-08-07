import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { adminPaths, publicPaths } from '@/app/router/paths'
import { getActiveEgresses, getSessionDetail, sessionIdFromRoomName } from '@/features/admin/adminService'
import { ApiError } from '@/shared/api/client'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { InlineNotice, PageHeader, Panel } from '@/shared/ui/WorkspaceUi'

function formatAt(iso: string | null): string {
  if (!iso) return '-'
  const time = new Date(iso).getTime()
  return Number.isFinite(time) ? new Date(time).toLocaleString() : '-'
}

function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '-'
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `${minutes}분 ${String(seconds).padStart(2, '0')}초`
}

function formatSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '-'
  const mb = bytes / (1024 * 1024)
  return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="admin-detail__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/** 켜짐·꺼짐을 색으로 구분한다. "자막이 안 나온다"는 문의에서 한눈에 봐야 하는 값이다. */
function Flag({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`admin-flag${on ? ' is-on' : ''}`}>
      {label} {on ? '켜짐' : '꺼짐'}
    </span>
  )
}

/**
 * 세션 하나의 운영 상세 — <b>읽기 전용</b>.
 *
 * <p><b>강사 화면을 열어 주는 대신 이 화면을 만들었다.</b> ADMIN은 도메인 게이트를 통과하지 않아
 * 강사 화면으로 링크하면 눌리지 않는 링크가 되고, 통과시키려면 게이트 15개 파일·37개 호출부를
 * 손대야 한다 — 인가 축 전면 변경이다. 필요한 값만 모아 보여 주면 그것을 건드리지 않고도 판단에
 * 필요한 것이 다 나온다(ADR-0089).
 *
 * <p>여기서 아무것도 바꾸지 않는다. 정지·정리 같은 조작은 Egress 콘솔이 이미 갖고 있고, 상태를
 * 보는 화면과 손대는 화면을 나눠 두면 "보러 왔다가 잘못 누르는" 일이 없다.
 */
export default function AdminSessionDetailPage() {
  const { sessionId = '' } = useParams()
  const query = useQuery({
    queryKey: ['admin-session-detail', sessionId],
    queryFn: () => getSessionDetail(sessionId),
    enabled: Boolean(sessionId),
    retry: false,
  })
  /*
   * 이 세션의 Egress가 지금 돌고 있는지는 LiveKit이 안다(DB가 아니다). 이미 있는 목록을 받아
   * 방 이름으로 찾는다 — 상세용 엔드포인트를 새로 만들 이유가 없다.
   */
  const egressQuery = useQuery({
    queryKey: ['admin-egress'],
    queryFn: getActiveEgresses,
    refetchInterval: 10_000,
  })
  const detail = query.data
  usePageTitle(detail?.lessonTitle ?? '세션 상세')

  const activeEgress = (egressQuery.data ?? [])
    .find((e) => sessionIdFromRoomName(e.roomName) === sessionId)

  if (!sessionId) return <PageState title="잘못된 경로입니다" description="세션 식별자를 확인해 주세요." />
  if (query.isPending) return <PageState title="세션을 불러오는 중입니다" description="잠시만 기다려 주세요." />
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <PageState
        title="이미 지워진 세션입니다"
        description="유령 Egress를 쫓아 들어왔다면 방은 남아 있고 세션만 사라진 상태입니다. Egress 관리에서 정리할 수 있습니다."
      />
    )
  }
  if (query.isError || !detail) {
    return <PageState title="세션을 불러오지 못했습니다" description="잠시 후 다시 시도해 주세요." />
  }

  const recording = detail.recording
  return (
    <div>
      <PageHeader
        title={detail.lessonTitle ?? '이름을 찾을 수 없는 강의'}
        description={detail.curriculumTitle ?? '커리큘럼을 찾을 수 없습니다.'}
      />

      <Panel title="세션">
        <dl className="admin-detail">
          <Row label="상태"><strong>{detail.status}</strong></Row>
          <Row label="커리큘럼">
            {detail.curriculumId && detail.curriculumTitle
              ? <Link to={publicPaths.curriculum(detail.curriculumId)}>{detail.curriculumTitle}</Link>
              : '-'}
          </Row>
          <Row label="강사">{detail.instructorName ?? '-'}</Row>
          <Row label="예정">{formatAt(detail.scheduledAt)}</Row>
          <Row label="시작">{formatAt(detail.startedAt)}</Row>
          <Row label="종료">{formatAt(detail.endedAt)}</Row>
          <Row label="기능">
            <span className="admin-flags">
              <Flag on={detail.features.recording} label="녹화" />
              <Flag on={detail.features.caption} label="자막" />
              <Flag on={detail.features.chat} label="채팅" />
              <Flag on={detail.features.aiQna} label="AI 질문" />
            </span>
          </Row>
          {/* LiveKit 콘솔·로그에서 찾을 때 쓰는 값들. 이 화면에 오는 이유의 절반이 이것이다. */}
          <Row label="방 이름"><code className="is-mono">{detail.roomName}</code></Row>
          <Row label="roomSid"><code className="is-mono">{detail.roomSid ?? '-'}</code></Row>
          <Row label="세션 id"><code className="is-mono">{detail.sessionId}</code></Row>
        </dl>
      </Panel>

      <Panel title="녹화">
        {!detail.features.recording ? (
          <InlineNotice tone="warning">
            이 세션은 녹화를 켜지 않고 시작해 다시보기가 만들어지지 않습니다.
          </InlineNotice>
        ) : !recording ? (
          <InlineNotice tone="info">아직 녹화 자산이 만들어지지 않았습니다.</InlineNotice>
        ) : (
          <>
            {recording.failureCode && (
              <InlineNotice tone="danger">
                녹화 처리에 실패했습니다 ({recording.failureCode}).
              </InlineNotice>
            )}
            <dl className="admin-detail">
              <Row label="자산 상태"><strong>{recording.status}</strong></Row>
              <Row label="공개 상태">{recording.replayStatus ?? '-'}</Row>
              <Row label="길이">{formatDuration(recording.durationMs)}</Row>
              <Row label="용량">{formatSize(recording.sizeBytes)}</Row>
              <Row label="녹화 시작">{formatAt(recording.startedAt)}</Row>
              <Row label="녹화 종료">{formatAt(recording.endedAt)}</Row>
              <Row label="자산 id"><code className="is-mono">{recording.videoAssetId}</code></Row>
            </dl>
          </>
        )}
      </Panel>

      <Panel title="Egress" description="LiveKit에 지금 살아 있는 작업입니다. 정지·정리는 Egress 관리에서 합니다.">
        {egressQuery.isPending ? (
          <p>확인하는 중입니다…</p>
        ) : activeEgress ? (
          <>
            <dl className="admin-detail">
              <Row label="상태"><strong>{activeEgress.state}</strong></Row>
              <Row label="egressId"><code className="is-mono">{activeEgress.egressId}</code></Row>
            </dl>
            <Link className="button button--soft" to={adminPaths.egress}>Egress 관리로</Link>
          </>
        ) : (
          <p>이 세션으로 진행 중인 Egress가 없습니다.</p>
        )}
      </Panel>

      <Link className="button button--ghost" to={adminPaths.overview}>운영 현황</Link>
    </div>
  )
}
