import { useState } from 'react'
import { ApiError } from '@/shared/api/client'
import { InlineNotice, StatusBadge } from '@/shared/ui/WorkspaceUi'
import type { EnrollmentRosterItem, EnrollmentStatus, InstructorEnrollmentAction } from './types'
import { useInstructorEnrollmentTransition } from './useEnrollmentMutations'
import { useInstructorEnrollmentRosterQuery } from './useEnrollmentQueries'

const dateFormatter = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' })

const statusLabel: Record<EnrollmentStatus, string> = {
  PENDING: '승인 대기',
  ACTIVE: '수강 중',
  REJECTED: '거절됨',
  REVOKED: '제적됨',
  CANCELLED: '취소됨',
}

function statusTone(status: EnrollmentStatus) {
  if (status === 'ACTIVE') return 'success' as const
  if (status === 'PENDING') return 'warning' as const
  return 'neutral' as const
}

function actionButton(
  label: string,
  action: InstructorEnrollmentAction,
  item: EnrollmentRosterItem,
  pending: boolean,
  run: (enrollmentId: string, action: InstructorEnrollmentAction) => void,
) {
  return (
    <button
      className="text-button"
      type="button"
      disabled={pending}
      onClick={() => run(item.enrollmentId, action)}
    >
      {label}
    </button>
  )
}

export default function InstructorEnrollmentRoster({ curriculumId }: { curriculumId: string }) {
  const [status, setStatus] = useState<EnrollmentStatus | ''>('')
  const [page, setPage] = useState(0)
  const query = useInstructorEnrollmentRosterQuery(curriculumId, {
    status: status || undefined,
    page,
    size: 20,
  })
  const transition = useInstructorEnrollmentTransition(curriculumId)
  const transitionError = transition.error instanceof ApiError ? transition.error.message : null

  const run = (enrollmentId: string, action: InstructorEnrollmentAction) => {
    transition.mutate({ enrollmentId, action })
  }

  if (query.isPending) return <p>수강생 목록을 불러오는 중입니다.</p>
  if (query.isError) {
    return <InlineNotice tone="danger">수강생 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</InlineNotice>
  }

  const { items, summary } = query.data

  return (
    <div>
      <div className="compact-controls">
        <select
          aria-label="수강 상태 필터"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as EnrollmentStatus | '')
            setPage(0)
          }}
        >
          <option value="">전체 상태</option>
          <option value="PENDING">승인 대기</option>
          <option value="ACTIVE">수강 중</option>
          <option value="REJECTED">거절됨</option>
          <option value="REVOKED">제적됨</option>
          <option value="CANCELLED">취소됨</option>
        </select>
        <span className="dashboard-meta">
          대기 {summary.pending} · 수강 {summary.active} · 거절 {summary.rejected} · 제적 {summary.revoked} · 취소 {summary.cancelled}
        </span>
      </div>

      {transitionError && <InlineNotice tone="danger">{transitionError}</InlineNotice>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>수강생</th><th>이메일</th><th>신청일</th><th>상태</th><th>행동</th></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.enrollmentId}>
                <td>{item.student.displayName ?? '이름 없음'}</td>
                <td>{item.student.email ?? '-'}</td>
                <td>{dateFormatter.format(new Date(item.requestedAt))}</td>
                <td><StatusBadge tone={statusTone(item.status)}>{statusLabel[item.status]}</StatusBadge></td>
                <td>
                  <div className="row-actions">
                    {item.allowedTransitions.includes('ACTIVE')
                      && actionButton('승인', 'approve', item, transition.isPending, run)}
                    {item.allowedTransitions.includes('REJECTED')
                      && actionButton('거절', 'reject', item, transition.isPending, run)}
                    {item.allowedTransitions.includes('REVOKED')
                      && actionButton('제적', 'revoke', item, transition.isPending, run)}
                    {item.allowedTransitions.length === 0 && <span>-</span>}
                  </div>
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5}>해당 상태의 수강 기록이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>

      {query.data.totalPages > 1 && (
        <div className="pagination">
          <button type="button" disabled={page === 0} onClick={() => setPage((value) => value - 1)}>이전</button>
          <span>{page + 1} / {query.data.totalPages}</span>
          <button type="button" disabled={!query.data.hasNext} onClick={() => setPage((value) => value + 1)}>다음</button>
        </div>
      )}
    </div>
  )
}
