import { Link } from 'react-router-dom'
import inkLandscapeWide from '@/assets/images/ink-landscape-wide-v1.jpg'
import { publicPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import CurriculumCoverFallback from '@/features/curriculum/CurriculumCoverFallback'
import type { CurriculumCardSummary } from '@/features/curriculum/types'
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

interface CuratedCurriculumProps {
  curriculum: CurriculumCardSummary
  index: number
}

function CuratedCurriculum({ curriculum, index }: CuratedCurriculumProps) {
  const curriculumPath = publicPaths.curriculum(curriculum.curriculumId)

  return (
    <article className={`curation-card curation-card--${index + 1}`}>
      <Link className="curation-card__link" to={curriculumPath}>
        <div className="curation-card__visual" aria-hidden="true">
          {curriculum.thumbnailUrl ? (
            <img src={curriculum.thumbnailUrl} alt="" />
          ) : (
            <CurriculumCoverFallback />
          )}
          <span>{String(index + 1).padStart(2, '0')}</span>
        </div>
        <div className="curation-card__body">
          <span className="curation-card__kicker">CURRICULUM</span>
          <h3>{curriculum.title}</h3>
          <p>{curriculum.summary}</p>
          <div className="curation-card__meta">
            <span>{curriculum.instructor.displayName} 강사</span>
            <span>{curriculum.lessonCount} LESSONS</span>
          </div>
          <span className="curation-card__arrow" aria-hidden="true">↗</span>
        </div>
      </Link>
    </article>
  )
}

function CuratedCurriculumSkeleton() {
  return (
    <div className="curation-grid curation-grid--loading" aria-label="커리큘럼을 불러오는 중" role="status">
      {Array.from({ length: 3 }, (_, index) => (
        <span className={`curation-skeleton curation-card--${index + 1}`} key={index} aria-hidden="true" />
      ))}
      <span className="visually-hidden">커리큘럼을 불러오고 있습니다.</span>
    </div>
  )
}

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
            <h1 className="hero-brand-title">
              <span>집현전</span>
              <small>LIVECLASS AI</small>
            </h1>
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
            <p className="ink-hero-art__statement">
              <span>수업은 지나가도,</span>
              <em>배움은 남도록.</em>
            </p>
            <div className="ink-hero-art__index" aria-hidden="true"><span>LIVE</span><span>CAPTION</span><span>AI</span><span>REPLAY</span></div>
          </figure>
        </div>
      </section>

      <section className="welcome-discovery">
        <div className="page-container welcome-discovery__grid">
          <section className="learning-flow" aria-labelledby="learning-flow-title">
            <header className="discovery-heading">
              <span className="eyebrow">01 — LEARNING FLOW</span>
              <h2 id="learning-flow-title">수업이 끝나도,<br />이해는 계속됩니다</h2>
              <p>배우는 흐름을 잇는 네 가지 핵심 경험</p>
            </header>

            <ol className="learning-flow__list">
              {features.map((feature) => (
                <li className="learning-flow__item" key={feature.key}>
                  <span className="learning-flow__number" aria-hidden="true">{feature.number}</span>
                  <div>
                    <h3>{feature.title}</h3>
                    <p>{feature.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className="curated-curriculums" aria-labelledby="curated-curriculums-title">
            <header className="discovery-heading discovery-heading--curated">
              <div>
                <span className="eyebrow">02 — CURATED CURRICULUMS</span>
                <h2 id="curated-curriculums-title">지금, 함께 배우기 좋은 수업</h2>
              </div>
              <Link className="curated-curriculums__all" to={publicPaths.curriculums}>
                전체 보기 <span aria-hidden="true">→</span>
              </Link>
            </header>

            {featuredQuery.isPending ? (
              <CuratedCurriculumSkeleton />
            ) : featuredQuery.isError ? (
              <div className="curated-curriculums__state">
                <PageState
                  compact
                  title="추천 커리큘럼을 불러오지 못했어요"
                  description="잠시 후 다시 시도해 주세요."
                  action={<button className="button button--soft" type="button" onClick={() => featuredQuery.refetch()}>다시 시도</button>}
                />
              </div>
            ) : featuredQuery.data.items.length === 0 ? (
              <div className="curated-curriculums__state">
                <PageState compact title="추천 커리큘럼을 준비하고 있어요" description="전체 커리큘럼에서 먼저 수업을 찾아보세요." action={<Link className="button button--soft" to={publicPaths.curriculums}>전체 둘러보기</Link>} />
              </div>
            ) : (
              <div className="curation-grid">
                {featuredQuery.data.items.slice(0, 3).map((curriculum, index) => (
                  <CuratedCurriculum key={curriculum.curriculumId} curriculum={curriculum} index={index} />
                ))}
              </div>
            )}
          </section>
        </div>
      </section>

    </>
  )
}
