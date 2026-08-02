import type { LearningBookmark } from '@/features/learning/learningService.interface'

/**
 * 내가 찍은 북마크를 시각으로 보여주고, 누르면 그 지점으로 보낸다.
 *
 * <p>북마크는 저장만 되고 다시 볼 방법이 없었다 — 찍는 행동의 목적이 "나중에 돌아오는 것"인데
 * 돌아올 길이 없으면 그 버튼은 아무것도 하지 않는 것과 같다.
 *
 * <p>자막 독 위에 얇게 둔다. 사이드바 탭을 하나 더 만들면 채팅·노트·AI·용어와 같은 무게가 되는데,
 * 북마크는 그만큼 자주 보는 것이 아니다.
 */
interface Props {
  bookmarks: LearningBookmark[]
  onSeek: (sessionMs: number) => void
  /** 종료된 라이브에서는 seek을 잠근다(진행 중 HLS와 같은 규칙). */
  canSeek: boolean
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export default function BookmarkStrip({ bookmarks, onSeek, canSeek }: Props) {
  if (bookmarks.length === 0) return null

  const ordered = [...bookmarks].sort((a, b) => a.sessionMs - b.sessionMs)

  return (
    <div aria-label="내 북마크" className="bookmark-strip" role="group">
      <span className="bookmark-strip__label">★ 내 북마크</span>
      <ul>
        {ordered.map((bookmark) => (
          <li key={`${bookmark.sessionMs}-${bookmark.createdAt}`}>
            {canSeek
              ? (
                <button type="button" onClick={() => onSeek(bookmark.sessionMs)}>
                  {formatTime(bookmark.sessionMs)}
                </button>
              )
              // 종료 뒤에는 이동할 수 없다. 누를 수 없는 버튼 대신 시각만 남긴다.
              : <time>{formatTime(bookmark.sessionMs)}</time>}
          </li>
        ))}
      </ul>
    </div>
  )
}
