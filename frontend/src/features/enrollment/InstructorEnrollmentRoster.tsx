import { useState } from 'react'
import { InlineNotice, StatusBadge } from '@/shared/ui/WorkspaceUi'
import type {
  EnrollmentRosterItem,
  EnrollmentStatus,
  EnrollmentStatusSummary,
  InstructorEnrollmentAction,
} from './types'
import { useInstructorEnrollmentTransition } from './useEnrollmentMutations'
import { useInstructorEnrollmentRosterQuery } from './useEnrollmentQueries'

const dateFormatter = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'medium' })
const MAX_VISIBLE_PAGES = 5
const ROSTER_PAGE_SIZE = 7

const statusLabel: Record<EnrollmentStatus, string> = {
  PENDING: '승인 대기',
  ACTIVE: '수강 중',
  REJECTED: '거절됨',
  REVOKED: '제적됨',
  CANCELLED: '취소됨',
}

/**
 * 상태 요약 셀 정의. 마크업을 상태 수만큼 반복해 쓰지 않도록 배열로 관리하고 map으로 렌더한다.
 * summaryKey는 서버 집계(EnrollmentStatusSummary)의 필드, status는 목록 필터 값이라 짝지어 둔다.
 */
const summaryCells: ReadonlyArray<{
  status: EnrollmentStatus
  summaryKey: keyof EnrollmentStatusSummary
  label: string
}> = [
  { status: 'PENDING', summaryKey: 'pending', label: '대기' },
  { status: 'ACTIVE', summaryKey: 'active', label: '수강 중' },
  { status: 'REJECTED', summaryKey: 'rejected', label: '거절' },
  { status: 'REVOKED', summaryKey: 'revoked', label: '제적' },
  { status: 'CANCELLED', summaryKey: 'cancelled', label: '취소' },
]

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

const ALL_STATUSES: readonly EnrollmentStatus[] = ['PENDING', 'ACTIVE', 'REJECTED', 'REVOKED', 'CANCELLED']

/** 딥링크로 들어온 필터 값을 신뢰하지 않는다 — 모르는 값이면 전체로 본다. */
function toStatusFilter(value: string | null): EnrollmentStatus | '' {
  return ALL_STATUSES.includes(value as EnrollmentStatus) ? (value as EnrollmentStatus) : ''
}

interface InstructorEnrollmentRosterProps {
  curriculumId: string
  /** 진입 시 적용할 상태 필터. 알림에서 온 경우 `PENDING`(승인 대기)이 넘어온다. */
  initialStatus?: string | null
  /** 목록에서 강조할 수강 신청. 어느 신청 때문에 이 화면에 왔는지 보이게 한다. */
  highlightEnrollmentId?: string | null
}

export default function InstructorEnrollmentRoster({
  curriculumId,
  initialStatus = null,
  highlightEnrollmentId = null,
}: InstructorEnrollmentRosterProps) {
  /*
    초기값으로만 쓴다(제어 상태로 만들지 않는다) — 알림에서 승인 대기 필터로 들어온 뒤 강사가
    "전체 상태"로 바꿨을 때 URL이 그대로라고 필터가 되돌아가면 조작이 먹지 않는 것처럼 보인다.
  */
  const [status, setStatus] = useState<EnrollmentStatus | ''>(() => toStatusFilter(initialStatus))
  const [page, setPage] = useState(0)
  const query = useInstructorEnrollmentRosterQuery(curriculumId, {
    status: status || undefined,
    page,
    size: ROSTER_PAGE_SIZE,
  })
  // 승인·거절·제적의 결과 알림은 useInstructorEnrollmentTransition이 토스트로 낸다.
  const transition = useInstructorEnrollmentTransition(curriculumId)

  const run = (enrollmentId: string, action: InstructorEnrollmentAction) => {
    transition.mutate({ enrollmentId, action })
  }

  if (query.isPending) return <p>수강생 목록을 불러오는 중입니다.</p>
  if (query.isError) {
    return <InlineNotice tone="danger">수강생 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</InlineNotice>
  }

  const { items, summary } = query.data
  const highlighted = highlightEnrollmentId
    ? items.find((item) => item.enrollmentId === highlightEnrollmentId) ?? null
    : null
  const visiblePageCount = Math.min(MAX_VISIBLE_PAGES, query.data.totalPages)
  const firstVisiblePage = Math.min(
    Math.max(0, page - Math.floor(visiblePageCount / 2)),
    query.data.totalPages - visiblePageCount,
  )
  const visiblePages = Array.from({ length: visiblePageCount }, (_, index) => firstVisiblePage + index)

  // 셀 클릭도 select와 같은 필터를 건드린다 — 집계·필터 로직은 그대로 두고 진입점만 늘렸다.
  const selectStatus = (next: EnrollmentStatus | '') => {
    setStatus(next)
    setPage(0)
  }

  return (
    <div>
      {/*
        알림에서 특정 신청자를 보러 왔는데 그 줄이 이 페이지에 없을 수 있다(이미 처리됐거나 다른
        페이지에 있다). 조용히 아무 것도 강조하지 않으면 "왜 여기로 데려왔는지" 알 수 없으므로
        찾지 못했다는 사실을 알린다.
      */}
      {highlightEnrollmentId && !highlighted && (
        <InlineNotice tone="info">
          알림이 가리킨 수강 신청을 이 목록에서 찾지 못했습니다. 이미 처리되었거나 다른 상태일 수 있어요.
        </InlineNotice>
      )}
      <div className="enrollment-roster-controls">
        <select
          aria-label="수강 상태 필터"
          value={status}
          onChange={(event) => selectStatus(event.target.value as EnrollmentStatus | '')}
        >
          <option value="">전체 상태</option>
          <option value="PENDING">승인 대기</option>
          <option value="ACTIVE">수강 중</option>
          <option value="REJECTED">거절됨</option>
          <option value="REVOKED">제적됨</option>
          <option value="CANCELLED">취소됨</option>
        </select>
        <div className="enrollment-status-summary">
          {summaryCells.map((cell) => {
            const selected = status === cell.status
            return (
              <button
                className={`enrollment-status-cell${selected ? ' is-selected' : ''}`}
                key={cell.status}
                type="button"
                aria-pressed={selected}
                // 이미 고른 상태를 다시 누르면 전체로 되돌린다.
                onClick={() => selectStatus(selected ? '' : cell.status)}
              >
                <span>{cell.label}</span>
                <strong>{summary[cell.summaryKey]}</strong>
              </button>
            )
          })}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>수강생</th><th>이메일</th><th>신청일</th><th>상태</th><th>행동</th></tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                className={item.enrollmentId === highlightEnrollmentId ? 'is-highlighted' : undefined}
                key={item.enrollmentId}
              >
                <td>
                  {item.student.displayName ?? '이름 없음'}
                  {item.enrollmentId === highlightEnrollmentId && (
                    <span className="visually-hidden">알림에서 확인한 수강 신청</span>
                  )}
                </td>
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
        <nav className="pagination" aria-label="수강생 목록 페이지">
          {visiblePages.map((pageNumber) => (
            <button
              className={`pagination__number${pageNumber === page ? ' is-current' : ''}`}
              type="button"
              aria-current={pageNumber === page ? 'page' : undefined}
              aria-label={`${pageNumber + 1}페이지`}
              key={pageNumber}
              onClick={() => setPage(pageNumber)}
            >
              {pageNumber + 1}
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}
