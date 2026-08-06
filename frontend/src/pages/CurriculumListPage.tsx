import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import inkLandscapeWide from '@/assets/images/ink-landscape-wide-v1.jpg'
import { useAuth } from '@/features/auth/AuthContext'
import CurriculumCard from '@/features/curriculum/CurriculumCard'
import CurriculumCardSkeleton from '@/features/curriculum/CurriculumCardSkeleton'
import type { CurriculumSort } from '@/features/curriculum/types'
import { useCurriculums } from '@/features/curriculum/useCurriculums'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import SearchIcon from '@/shared/ui/SearchIcon'

const validSorts = new Set<CurriculumSort>(['LATEST', 'TITLE_ASC'])
const SEARCH_DEBOUNCE_MS = 300
const MAX_VISIBLE_PAGES = 5
const LOADING_ICON_DELAY_MS = 500
const CURRICULUM_PAGE_SIZE = 10

function getPageWindow(current: number, total: number, maxVisible: number) {
  if (total <= maxVisible) return Array.from({ length: total }, (_, index) => index)
  const half = Math.floor(maxVisible / 2)
  const start = Math.min(Math.max(current - half, 0), total - maxVisible)
  return Array.from({ length: maxVisible }, (_, index) => start + index)
}

export default function CurriculumListPage() {
  usePageTitle('커리큘럼 탐색')
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const queryText = searchParams.get('q') ?? ''
  const [searchInput, setSearchInput] = useState(queryText)
  const sortParam = searchParams.get('sort') as CurriculumSort | null
  const sort = sortParam && validSorts.has(sortParam) ? sortParam : 'LATEST'
  const rawPage = Number(searchParams.get('page') ?? '0')
  const page = Number.isInteger(rawPage) && rawPage >= 0 ? rawPage : 0

  useEffect(() => setSearchInput(queryText), [queryText])

  const [showLoadingIcon, setShowLoadingIcon] = useState(false)

  const curriculumQuery = useCurriculums(
    {
      q: queryText || undefined,
      lifecycleStatus: 'PUBLISHED',
      sort,
      page,
      size: CURRICULUM_PAGE_SIZE,
    },
    user ?? undefined,
  )

  const isFetching = curriculumQuery.isFetching
  useEffect(() => {
    if (!isFetching) {
      setShowLoadingIcon(false)
      return
    }
    const timer = window.setTimeout(() => setShowLoadingIcon(true), LOADING_ICON_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [isFetching])

  const updateParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams)
    Object.entries(changes).forEach(([key, value]) => {
      if (!value) next.delete(key)
      else next.set(key, value)
    })
    setSearchParams(next)
  }

  useEffect(() => {
    const trimmed = searchInput.trim()
    if (trimmed === queryText) return
    // 검색어를 지우면(trimmed === '') 디바운스 없이 즉시 전체 목록으로 되돌린다.
    const delay = trimmed === '' ? 0 : SEARCH_DEBOUNCE_MS
    const timer = window.setTimeout(() => {
      updateParams({ q: trimmed || null, page: null })
    }, delay)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput, queryText])

  const handleSearch = (event: FormEvent) => {
    event.preventDefault()
    updateParams({ q: searchInput.trim() || null, page: null })
  }

  const resetFilters = () => {
    setSearchInput('')
    setSearchParams({})
  }

  const data = curriculumQuery.data
  const hasConditions = Boolean(queryText || sort !== 'LATEST')

  return (
    <div className="catalog-page">
      {showLoadingIcon && (
        <div className="catalog-loading-overlay" role="status" aria-label="결과를 업데이트하고 있어요">
          <span className="spinner" aria-hidden="true" />
        </div>
      )}
      <section className="catalog-hero">
        <img className="catalog-hero__art" src={inkLandscapeWide} alt="" aria-hidden="true" decoding="async" fetchPriority="high" />
        <div className="page-container catalog-hero__inner">
          <div className="catalog-hero__copy">
            <span className="catalog-hero__kicker">CURATED LEARNING ARCHIVE</span>
            <h1><span>배움이 머무는 곳,</span><em>함께 더 멀리.</em></h1>
            <p>관심 있는 주제를 검색하고 라이브로 소통하는 커리큘럼을 만나보세요.</p>
          </div>
        </div>
      </section>

      <section className="catalog-content page-container">
        <form className="catalog-controls" onSubmit={handleSearch} role="search">
          <div className="catalog-summary" aria-live="polite">
            <div>
              <h2>{queryText ? `‘${queryText}’ 검색 결과` : '전체 커리큘럼'}</h2>
              {data && <p><strong>{data.totalElements}</strong>개</p>}
            </div>
            {hasConditions && <button className="reset-button" type="button" onClick={resetFilters}>초기화</button>}
          </div>
          <label className="search-field">
            <span className="visually-hidden">커리큘럼 검색</span>
            <SearchIcon />
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="제목으로 검색" />
            {searchInput && <button type="button" aria-label="검색어 지우기" onClick={() => setSearchInput('')}>×</button>}
          </label>
          <label className="sort-field">
            <span className="visually-hidden">정렬 기준</span>
            <select value={sort} onChange={(event) => updateParams({ sort: event.target.value === 'LATEST' ? null : event.target.value, page: null })}>
              <option value="LATEST">최신순</option>
              <option value="TITLE_ASC">이름순</option>
            </select>
          </label>
        </form>

        {curriculumQuery.isPending ? (
          <CurriculumCardSkeleton count={CURRICULUM_PAGE_SIZE} />
        ) : curriculumQuery.isError ? (
          <PageState title="커리큘럼을 불러오지 못했어요" description="네트워크 연결을 확인한 뒤 다시 시도해 주세요." action={<button className="button button--primary" type="button" onClick={() => curriculumQuery.refetch()}>다시 시도</button>} />
        ) : !data ? (
          <CurriculumCardSkeleton count={CURRICULUM_PAGE_SIZE} />
        ) : data.items.length === 0 ? (
          <PageState
            title={hasConditions ? '검색 조건에 맞는 커리큘럼이 없어요' : '공개된 커리큘럼을 준비하고 있어요'}
            description={hasConditions ? '검색어를 줄이거나 조건을 초기화해 보세요.' : '곧 새로운 라이브 커리큘럼으로 찾아올게요.'}
            action={hasConditions ? <button className="button button--soft" type="button" onClick={resetFilters}>전체 커리큘럼 보기</button> : <Link className="button button--soft" to="/">웰컴으로 돌아가기</Link>}
          />
        ) : (
          <>
            <div className={`curriculum-grid${curriculumQuery.isFetching ? ' is-updating' : ''}`}>
              {data.items.map((curriculum) => <CurriculumCard key={curriculum.curriculumId} curriculum={curriculum} />)}
            </div>
            {data.totalPages > 1 && (() => {
              const pageWindow = getPageWindow(page, data.totalPages, MAX_VISIBLE_PAGES)
              const [firstVisible] = pageWindow
              const lastVisible = pageWindow[pageWindow.length - 1]
              return (
                <nav className="pagination" aria-label="커리큘럼 페이지">
                  <button type="button" disabled={page === 0} onClick={() => updateParams({ page: page - 1 === 0 ? null : String(page - 1) })} aria-label="이전 페이지">←</button>
                  {firstVisible > 0 && <span className="pagination-ellipsis" aria-hidden="true">…</span>}
                  {pageWindow.map((index) => (
                    <button className={`pagination__number${index === page ? ' is-current' : ''}`} type="button" key={index} aria-current={index === page ? 'page' : undefined} onClick={() => updateParams({ page: index === 0 ? null : String(index) })}>{index + 1}</button>
                  ))}
                  {lastVisible < data.totalPages - 1 && <span className="pagination-ellipsis" aria-hidden="true">…</span>}
                  <button type="button" disabled={!data.hasNext} onClick={() => updateParams({ page: String(page + 1) })} aria-label="다음 페이지">→</button>
                </nav>
              )
            })()}
          </>
        )}
      </section>
    </div>
  )
}
