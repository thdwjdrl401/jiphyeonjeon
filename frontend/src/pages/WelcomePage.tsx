import { Link } from 'react-router-dom'
import inkLandscapeWide from '@/assets/images/ink-landscape-wide-v1.jpg'
import { instructorPaths, publicPaths } from '@/app/router/paths'
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
            <span className="hero-kicker"><i /> DIGITAL LEARNING ARCHIVE</span>
            <h1><span>수업은</span><br /><span>지나가도,</span><br /><em>배움은 남도록.</em></h1>
            <p>라이브 수업의 자막과 질문, AI 설명, 다시보기를<br />하나의 학습 기록으로 이어갑니다.</p>
            <div className="hero-actions">
              {user ? (
                <Link className="button button--primary button--large" to={publicPaths.curriculums}>
                  커리큘럼 탐색 <span aria-hidden="true">→</span>
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

          <figure className="hero-stage ink-hero-art" aria-label="겹겹이 쌓이는 배움을 표현한 현대 수묵화">
            <img src={inkLandscapeWide} alt="" aria-hidden="true" fetchPriority="high" />
            <figcaption><span>01</span><p>질문과 자막, 다시보기가<br />하나의 학습 기록으로 이어집니다.</p></figcaption>
            <div className="ink-hero-art__index" aria-hidden="true"><span>LIVE</span><span>CAPTION</span><span>AI</span><span>REPLAY</span></div>
          </figure>
        </div>
      </section>

      <section className="feature-section section-space">
        <div className="page-container">
          <div className="section-heading section-heading--center">
            <span className="eyebrow">01 — LEARNING FLOW</span>
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
              <span className="eyebrow">02 — CURATED CURRICULUMS</span>
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
            <span className="eyebrow eyebrow--light">03 — CONTINUE THE ARCHIVE</span>
            <h2>{user ? `${user.displayName}님, 오늘의 배움을 이어갈까요?` : '배움의 다음 장면을 시작하세요'}</h2>
            <p>{user?.role === 'INSTRUCTOR' ? '운영 중인 커리큘럼을 확인하고 다음 라이브를 준비해 보세요.' : user ? '내 커리큘럼에서 최근 학습과 다음 라이브 일정을 확인해 보세요.' : '학생으로 배우거나, 강사로 지식을 나누는 여정을 시작할 수 있어요.'}</p>
          </div>
          <div className="quick-action-buttons">
            {user ? (
              <>
                <Link className="button button--white button--large" to={publicPaths.curriculums}>커리큘럼 탐색</Link>
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
