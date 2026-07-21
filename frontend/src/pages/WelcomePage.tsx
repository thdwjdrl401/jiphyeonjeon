import { Link } from 'react-router-dom'
import { getRoleHomePath, instructorPaths, publicPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import CurriculumCard from '@/features/curriculum/CurriculumCard'
import CurriculumCardSkeleton from '@/features/curriculum/CurriculumCardSkeleton'
import { useCurriculums } from '@/features/curriculum/useCurriculums'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'

const features = [
  {
    key: 'live',
    number: '01',
    title: '몰입하는 라이브 수업',
    description: '안정적인 실시간 영상과 채팅으로 강사와 학습자가 같은 흐름에서 만나요.',
  },
  {
    key: 'caption',
    number: '02',
    title: '놓치지 않는 실시간 자막',
    description: '수업의 발화를 바로 읽고, 지나간 설명도 시간축 위에서 다시 확인해요.',
  },
  {
    key: 'evidence',
    number: '03',
    title: '근거를 보여주는 AI',
    description: '강의 자료와 실제 발화를 근거로 답해 더 안심하고 깊게 질문할 수 있어요.',
  },
  {
    key: 'replay',
    number: '04',
    title: '배움이 이어지는 다시보기',
    description: '자막, 북마크, 퀴즈와 함께 나에게 필요한 구간부터 학습을 이어가요.',
  },
]

export default function WelcomePage() {
  usePageTitle('라이브의 순간을 내 학습으로')
  const { user } = useAuth()
  const featuredQuery = useCurriculums(
    { featured: true, lifecycleStatus: 'PUBLISHED', sort: 'RECOMMENDED', page: 0, size: 6 },
    user ?? undefined,
  )

  return (
    <>
      <section className="welcome-hero">
        <div className="page-container welcome-hero__grid">
          <div className="hero-copy">
            <span className="hero-kicker"><i /> Live learning, reimagined with AI</span>
            <h1>라이브의 순간을 놓치지 않고,<br /><em>나의 배움으로.</em></h1>
            <p>실시간 수업부터 자막, 근거 기반 AI 설명, 다시보기까지.<br />이해가 이어지는 하나의 학습 경험을 만나보세요.</p>
            <div className="hero-actions">
              {user ? (
                <Link className="button button--primary button--large" to={getRoleHomePath(user.role)}>
                  내 커리큘럼 <span aria-hidden="true">→</span>
                </Link>
              ) : (
                <Link className="button button--primary button--large" to={publicPaths.curriculums}>
                  커리큘럼 둘러보기 <span aria-hidden="true">→</span>
                </Link>
              )}
              {!user && (
                <Link className="button button--soft button--large" to={publicPaths.signup}>
                  무료로 시작하기
                </Link>
              )}
            </div>
            <div className="hero-proof" aria-label="서비스 특징">
              <span><strong>LIVE</strong> 실시간 몰입</span>
              <span><strong>AI</strong> 근거 있는 답변</span>
              <span><strong>VOD</strong> 끊김 없는 복습</span>
            </div>
          </div>

          <div className="hero-stage" aria-label="LiveClass AI 수업 화면 예시">
            <span className="hero-stage__halo" />
            <div className="classroom-preview">
              <div className="classroom-preview__topbar">
                <span className="window-dots"><i /><i /><i /></span>
                <span className="preview-live"><i /> LIVE · 32:18</span>
                <span className="preview-viewers">128명</span>
              </div>
              <div className="classroom-preview__screen">
                <div className="instructor-tile">
                  <span className="instructor-avatar">이</span>
                  <span>이도현 강사</span>
                </div>
                <div className="code-panel" aria-hidden="true">
                  <span className="code-line code-line--a" />
                  <span className="code-line code-line--b" />
                  <span className="code-line code-line--c" />
                  <span className="code-line code-line--d" />
                </div>
                <div className="live-caption">
                  <small>실시간 자막</small>
                  <p>이 요청은 서비스 계층에서 하나의 트랜잭션으로 처리됩니다.</p>
                </div>
              </div>
              <div className="classroom-preview__toolbar">
                <span>◉</span><span>⌁</span><span>CC</span><span>•••</span>
              </div>
            </div>
            <div className="ai-note-card">
              <span className="ai-note-icon">AI</span>
              <div><small>근거를 찾았어요</small><strong>트랜잭션 경계 · 12번 슬라이드</strong></div>
            </div>
            <div className="caption-chip"><i /> 자막 정확도 98.7%</div>
          </div>
        </div>
      </section>

      <section className="feature-section section-space">
        <div className="page-container">
          <div className="section-heading section-heading--center">
            <span className="eyebrow">WHY LIVECLASS AI</span>
            <h2>수업이 끝나도, 이해는 계속됩니다</h2>
            <p>배우는 흐름을 끊지 않는 네 가지 핵심 경험</p>
          </div>
          <div className="feature-grid">
            {features.map((feature) => (
              <article className="feature-card" key={feature.key}>
                <span className={`feature-icon feature-icon--${feature.key}`} aria-hidden="true">
                  {feature.number}
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="featured-section section-space">
        <div className="page-container">
          <div className="section-heading section-heading--split">
            <div>
              <span className="eyebrow">FEATURED CURRICULUMS</span>
              <h2>지금, 함께 배우기 좋은 수업</h2>
              <p>라이브로 질문하고 AI와 함께 깊이 이해해 보세요.</p>
            </div>
            <Link className="text-link text-link--large" to={publicPaths.curriculums}>전체 커리큘럼 보기 <span aria-hidden="true">→</span></Link>
          </div>

          {featuredQuery.isPending ? (
            <CurriculumCardSkeleton count={3} />
          ) : featuredQuery.isError ? (
            <PageState
              compact
              title="추천 커리큘럼을 불러오지 못했어요"
              description="서비스 소개는 계속 둘러볼 수 있어요. 잠시 후 다시 시도해 주세요."
              action={<button className="button button--soft" type="button" onClick={() => featuredQuery.refetch()}>다시 시도</button>}
            />
          ) : featuredQuery.data.items.length === 0 ? (
            <PageState compact title="추천 커리큘럼을 준비하고 있어요" description="전체 커리큘럼에서 먼저 마음에 드는 수업을 찾아보세요." action={<Link className="button button--soft" to={publicPaths.curriculums}>전체 둘러보기</Link>} />
          ) : (
            <div className="curriculum-grid curriculum-grid--featured">
              {featuredQuery.data.items.slice(0, 3).map((curriculum) => (
                <CurriculumCard key={curriculum.curriculumId} curriculum={curriculum} compact />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="quick-action-section">
        <div className="page-container quick-action-panel">
          <div>
            <span className="eyebrow eyebrow--light">READY TO LEARN?</span>
            <h2>{user ? `${user.displayName}님, 오늘의 배움을 이어갈까요?` : '배움의 다음 장면을 시작하세요'}</h2>
            <p>{user?.role === 'INSTRUCTOR' ? '운영 중인 커리큘럼을 확인하고 다음 라이브를 준비해 보세요.' : user ? '내 커리큘럼에서 최근 학습과 다음 라이브 일정을 확인해 보세요.' : '학생으로 배우거나, 강사로 지식을 나누는 여정을 시작할 수 있어요.'}</p>
          </div>
          <div className="quick-action-buttons">
            {user ? (
              <>
                <Link className="button button--white button--large" to={getRoleHomePath(user.role)}>내 커리큘럼</Link>
                {user.role === 'INSTRUCTOR' && <Link className="button button--outline-light button--large" to={instructorPaths.newCurriculum}>새 커리큘럼 만들기</Link>}
              </>
            ) : (
              <>
                <Link className="button button--white button--large" to={publicPaths.signup}>무료로 시작하기</Link>
                <Link className="button button--outline-light button--large" to={publicPaths.login}>이미 계정이 있어요</Link>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
