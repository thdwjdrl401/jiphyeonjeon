import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { LearningBookmark } from '@/features/learning/learningService.interface'

/**
 * 내가 찍은 북마크를 시각으로 보여주고, 누르면 그 지점으로 보낸다.
 *
 * <p>북마크는 저장만 되고 다시 볼 방법이 없었다 — 찍는 행동의 목적이 "나중에 돌아오는 것"인데
 * 돌아올 길이 없으면 그 버튼은 아무것도 하지 않는 것과 같다.
 *
 * <p>자막 독 위에 얇게 둔다. 사이드바 탭을 하나 더 만들면 채팅·노트·AI·용어와 같은 무게가 되는데,
 * 북마크는 그만큼 자주 보는 것이 아니다.
 *
 * <p>카드는 <b>한 줄을 벗어나지 않는다</b> — 줄바꿈하면 자막 독을 밀어내릴 만큼 늘어날 수 있다.
 * 넘치면 좌우 화살표로 넘겨 보고(overflow-x는 스크롤로도 열려 있다), 삭제 버튼을 누르면 각 카드
 * 우측 상단에 지우기 배지가 떠 눌러서 지울 수 있다.
 */
interface Props {
  bookmarks: LearningBookmark[]
  onSeek: (sessionMs: number) => void
  /** 종료된 라이브에서는 seek을 잠근다(진행 중 HLS와 같은 규칙). */
  canSeek: boolean
  onDelete: (bookmarkId: string) => void
}

/** 화살표 한 번에 넘기는 양 — 목록 폭의 대부분(80%)만큼, 한 번에 다음 카드 몇 개가 한눈에 이어 보이게. */
const SCROLL_PAGE_RATIO = 0.8

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export default function BookmarkStrip({ bookmarks, onSeek, canSeek, onDelete }: Props) {
  const [isDeleteMode, setDeleteMode] = useState(false)
  const [hasOverflow, setHasOverflow] = useState(false)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(true)
  const listRef = useRef<HTMLUListElement>(null)

  const updateScrollState = useCallback(() => {
    const list = listRef.current
    if (!list) return
    setHasOverflow(list.scrollWidth > list.clientWidth + 1)
    setAtStart(list.scrollLeft <= 0)
    setAtEnd(list.scrollLeft + list.clientWidth >= list.scrollWidth - 1)
  }, [])

  const ordered = [...bookmarks].sort((a, b) => a.sessionMs - b.sessionMs)

  // 카드 폭은 고정이라 개수가 바뀔 때만 넘침 여부가 달라진다.
  useLayoutEffect(() => { updateScrollState() }, [ordered.length, updateScrollState])

  if (bookmarks.length === 0) return null

  const scrollByPage = (direction: 1 | -1) => {
    const list = listRef.current
    if (!list) return
    list.scrollLeft += direction * list.clientWidth * SCROLL_PAGE_RATIO
    updateScrollState()
  }

  return (
    <div aria-label="내 북마크" className="bookmark-strip" role="group">
      <div className="bookmark-strip__header">
        <span className="bookmark-strip__label">내 북마크</span>
        <button
          aria-pressed={isDeleteMode}
          className="bookmark-strip__delete-toggle"
          type="button"
          onClick={() => setDeleteMode((current) => !current)}
        >
          {isDeleteMode ? '삭제 완료' : '북마크 삭제'}
        </button>
      </div>
      <div className="bookmark-strip__carousel">
        {hasOverflow && (
          <button
            aria-label="이전 북마크"
            className="bookmark-strip__nav bookmark-strip__nav--prev"
            disabled={atStart}
            type="button"
            onClick={() => scrollByPage(-1)}
          >
            ‹
          </button>
        )}
        <ul className="bookmark-strip__list" ref={listRef} onScroll={updateScrollState}>
          {ordered.map((bookmark) => (
            <li className="bookmark-strip__card" key={bookmark.bookmarkId}>
              {isDeleteMode && (
                <button
                  aria-label={`${formatTime(bookmark.sessionMs)} 북마크 삭제`}
                  className="bookmark-strip__remove"
                  type="button"
                  onClick={() => onDelete(bookmark.bookmarkId)}
                >
                  ×
                </button>
              )}
              {canSeek && !isDeleteMode
                ? (
                  <button className="bookmark-strip__chip" type="button" onClick={() => onSeek(bookmark.sessionMs)}>
                    {formatTime(bookmark.sessionMs)}
                  </button>
                )
                // 종료 뒤 또는 삭제 모드에서는 이동할 수 없다 — 누를 수 없는 버튼 대신 시각만 남긴다.
                : <time className="bookmark-strip__chip">{formatTime(bookmark.sessionMs)}</time>}
            </li>
          ))}
        </ul>
        {hasOverflow && (
          <button
            aria-label="다음 북마크"
            className="bookmark-strip__nav bookmark-strip__nav--next"
            disabled={atEnd}
            type="button"
            onClick={() => scrollByPage(1)}
          >
            ›
          </button>
        )}
      </div>
    </div>
  )
}
