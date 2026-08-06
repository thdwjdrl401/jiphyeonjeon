import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { publicPaths } from '@/app/router/paths'
import { getSessionLabels, type SessionLabel } from './adminService'

/**
 * 여러 세션의 이름표를 <b>한 번에</b> 받아 id로 찾아 쓰게 한다.
 *
 * <p>표를 그리면서 행마다 부르면 행 수만큼 왕복이 생긴다. 화면이 id를 모아 이 훅에 넘기고, 각 행은
 * 받은 Map에서 꺼내 쓴다.
 *
 * <p>이름표가 없다고 표가 비지 않는다 — 이 조회가 실패해도 상태·시각·정지 버튼은 그대로 있어야
 * 한다. 운영 화면이 부가 정보 하나 때문에 통째로 못 쓰게 되면 안 된다.
 */
export function useSessionLabels(sessionIds: Array<string | null>) {
  const ids = Array.from(new Set(sessionIds.filter((id): id is string => Boolean(id)))).sort()
  const query = useQuery({
    // 키에 id 목록을 넣는다 — 표가 바뀌면 다시 받아야 하고, 같은 목록이면 캐시를 쓴다.
    queryKey: ['admin-session-labels', ids],
    queryFn: () => getSessionLabels(ids),
    enabled: ids.length > 0,
    retry: false,
    staleTime: 60_000,
  })
  const byId = new Map<string, SessionLabel>()
  for (const label of query.data ?? []) byId.set(label.sessionId, label)
  return byId
}

interface SessionLabelCellProps {
  sessionId: string | null
  label: SessionLabel | undefined
}

/**
 * 표 한 칸에 "어느 강의인가"를 그린다.
 *
 * <p>운영자가 강제 정지를 누를지 판단하는 근거가 이 칸이다. UUID만 있을 때는 그 판단을 할 수 없었다.
 *
 * <p>링크는 <b>공개 커리큘럼 페이지 하나뿐</b>이다. 강의 상세·처리 현황은 소유 강사나 수강생만 열 수
 * 있어서(ADMIN은 그 게이트를 통과하지 않는다) 걸어 봐야 눌리지 않는다. 열리지 않는 링크를 두는 것은
 * 없는 것보다 나쁘다.
 *
 * <p>UUID는 지우지 않고 작게 남긴다 — 로그를 찾거나 문의를 받을 때 필요한 것이 결국 그 값이다.
 */
export default function SessionLabelCell({ sessionId, label }: SessionLabelCellProps) {
  const lessonTitle = label?.lessonTitle
  const curriculumTitle = label?.curriculumTitle
  const curriculumId = label?.curriculumId

  return (
    <div className="admin-session-label">
      {lessonTitle
        ? <strong className="admin-session-label__lesson">{lessonTitle}</strong>
        : <strong className="admin-session-label__lesson is-unknown">이름을 찾을 수 없음</strong>}
      {curriculumTitle && (
        <span className="admin-session-label__curriculum">
          {curriculumId
            ? <Link to={publicPaths.curriculum(curriculumId)}>{curriculumTitle}</Link>
            : curriculumTitle}
        </span>
      )}
      {sessionId && <code className="admin-session-label__id is-mono">{sessionId}</code>}
    </div>
  )
}
