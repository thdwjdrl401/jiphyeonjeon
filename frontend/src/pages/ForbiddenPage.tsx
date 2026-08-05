import { Link, useSearchParams } from 'react-router-dom'
import { getRoleHomePath, publicPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import BrandLink from '@/shared/layout/BrandLink'

const reasonCopy = {
  student: ['학생 전용 기능이에요', '학습과 수강 기능은 학생 계정에서 사용할 수 있습니다.'],
  instructor: ['강사 전용 기능이에요', '커리큘럼 생성과 운영 기능은 강사 계정에서 사용할 수 있습니다.'],
  enrollment: ['수강 권한이 필요해요', '커리큘럼 상세에서 수강 상태와 신청 가능 여부를 확인해 주세요.'],
  ownership: ['관리 권한이 없어요', '해당 커리큘럼을 운영하는 강사만 이 작업을 수행할 수 있습니다.'],
} as const

export default function ForbiddenPage() {
  const [params] = useSearchParams()
  const { user } = useAuth()
  const reason = params.get('reason') as keyof typeof reasonCopy | null
  const [title, description] = reasonCopy[reason ?? 'ownership'] ?? reasonCopy.ownership
  const curriculumLabel = user?.role === 'INSTRUCTOR' ? '커리큘럼 관리' : '내 커리큘럼'
  usePageTitle('접근할 수 없음')
  return <div className="system-page"><header><BrandLink /></header><main><div className="system-code system-code--forbidden" aria-hidden="true">403</div><span className="eyebrow">ACCESS RESTRICTED</span><h1>{title}</h1><p>{description}<br />권한 정보는 서버에서 다시 확인됩니다.</p><div className="system-actions"><Link className="button button--primary button--large" to={user ? getRoleHomePath(user.role) : publicPaths.login}>{user ? curriculumLabel : '로그인'}</Link><Link className="button button--soft button--large" to={publicPaths.curriculums}>커리큘럼 탐색</Link></div></main></div>
}
