import { Link } from 'react-router-dom'

interface GuestActionsProps {
  returnTo: string
}

export default function GuestActions({ returnTo }: GuestActionsProps) {
  const query = `returnTo=${encodeURIComponent(returnTo)}`

  return (
    <div className="relation-panel guest-actions">
      <h2>수강하려면 로그인이 필요해요</h2>
      <p>로그인하면 원래 보고 있던 커리큘럼으로 바로 돌아와요.</p>
      <div className="guest-actions__buttons">
        <Link className="button button--primary" to={`/login?${query}`}>로그인하기</Link>
        <Link className="button button--soft" to={`/signup?${query}`}>학생으로 회원가입</Link>
      </div>
    </div>
  )
}
