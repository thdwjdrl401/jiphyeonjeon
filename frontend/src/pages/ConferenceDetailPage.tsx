import { useParams } from 'react-router-dom'

export function ConferenceDetailPage() {
  const { conferenceId } = useParams<{ conferenceId: string }>()
  return <div className="page-panel">{conferenceId}번 방 상세 보기 페이지</div>
}
