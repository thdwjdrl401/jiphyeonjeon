import { useCallback, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { studentPaths } from '@/app/router/paths'
import HlsMediaPlayer, { type HlsMediaState } from '@/features/media/HlsMediaPlayer'
import { recordedPlaybackErrorMessage } from '@/features/recorded-lesson/recordedLessonProcessing'
import { useRecordedPlayback } from '@/features/recorded-lesson/useRecordedLessonQueries'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { StatusBadge } from '@/shared/ui/WorkspaceUi'

function stateLabel(state: HlsMediaState) {
  if (state === 'playing') return '재생 중'
  if (state === 'ready') return '재생 준비됨'
  if (state === 'buffering') return '버퍼링 중'
  if (state === 'error') return '재생 오류'
  return '플레이어 준비 중'
}

/** 게시가 끝난 업로드 녹화강의를 학생에게 HLS+WebVTT 한 패키지로 보여준다. */
export default function RecordedLessonPlaybackPage() {
  const { lessonId = '' } = useParams()
  const [playerState, setPlayerState] = useState<HlsMediaState>('loading')
  const [reloadToken, setReloadToken] = useState(0)
  const playbackQuery = useRecordedPlayback(lessonId, Boolean(lessonId))
  const playback = playbackQuery.data
  usePageTitle('녹화강의')

  const retry = useCallback(() => {
    setPlayerState('loading')
    setReloadToken((current) => current + 1)
    void playbackQuery.refetch()
  }, [playbackQuery])

  if (!lessonId) return <PageState title="잘못된 녹화강의 경로입니다" />
  if (playbackQuery.isPending) {
    return <PageState title="녹화강의를 불러오는 중입니다" description="영상과 자막 재생 정보를 확인하고 있습니다." />
  }
  if (playbackQuery.isError || !playback) {
    return (
      <PageState
        title="녹화강의를 재생할 수 없습니다"
        description={recordedPlaybackErrorMessage(playbackQuery.error)}
        action={<button className="button button--soft" type="button" onClick={retry}>다시 시도</button>}
      />
    )
  }

  const captionTracks = playback.captions.tracks.map((track) => ({
    trackId: track.trackId,
    src: track.url,
    kind: track.kind,
    label: track.label,
    language: track.language,
    default: track.default,
    version: track.version,
  }))

  return (
    <div className="media-page replay-page">
      <header className="media-page__title">
        <div>
          <StatusBadge tone="success">RECORDED</StatusBadge>
          <h1>녹화강의</h1>
          <small>{playback.captions.status === 'AVAILABLE' ? '한국어 자막 제공' : '발화 자막 없음'}</small>
        </div>
        <div className="media-page__status">
          <StatusBadge tone={playerState === 'error' ? 'danger' : playerState === 'buffering' || playerState === 'loading' ? 'warning' : 'success'}>
            {stateLabel(playerState)}
          </StatusBadge>
          <Link className="button button--soft button--small" to={studentPaths.curriculums}>내 커리큘럼</Link>
        </div>
      </header>

      <div className="media-layout">
        <section className="media-primary">
          <HlsMediaPlayer
            sourceUrl={playback.source.url}
            title="녹화강의"
            streamType="on-demand"
            durationMs={playback.durationMs}
            reloadToken={reloadToken}
            captionTracks={captionTracks}
            className="recorded-lesson-player"
            onStateChange={setPlayerState}
          />
          {playerState === 'error' && (
            <div className="recorded-player-message recorded-player-message--error" role="alert">
              <strong>녹화강의를 재생하지 못했습니다.</strong>
              <button className="button button--soft" type="button" onClick={retry}>재생 정보 다시 받기</button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
