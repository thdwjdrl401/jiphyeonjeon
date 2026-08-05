import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { CurriculumLiveSessionStatus } from '@/features/lesson/types'
import { getAiAnswerHistory } from './liveSessionService'
import {
  devAppendAiHistorySample,
  devAppendChatSample,
  devAppendGlossarySample,
  devAppendLectureNoteSample,
  devPushCaptionLine,
  devPushChatMessage,
  devResetAiHistory,
  devResetChat,
  devResetGlossary,
  devResetLectureNote,
  devSetCaptionConnectionState,
  devSetChatConnectionState,
  devSetLiveSessionStatusOverride,
  devSetParticipantCount,
} from './mockLiveSessionService'
import type { ChatConnectionState, LiveSessionView } from './liveSessionService.interface'

const statusOptions: CurriculumLiveSessionStatus[] = ['STARTING', 'LIVE', 'ENDING', 'ENDED']
const connectionOptions: ChatConnectionState[] = ['connected', 'connecting', 'reconnecting', 'error']
const longSampleText = '이 문장은 말풍선이 길어질 때 줄바꿈·여백·좌우 정렬이 무너지지 않는지 보려고 일부러 길게 씁니다. 자막도 채팅도 실제로는 이 정도 길이가 흔합니다.'

/** 기본 자리(우하단 고정)에서 한 번이라도 끌어 옮기면 그 자리를 기억한다 — 새로고침마다 되돌아오면 매번 다시 옮겨야 한다. */
const DRAG_POSITION_STORAGE_KEY = 'liveclass.devPanel.position'

interface PanelPosition { left: number; top: number }

function readStoredPosition(): PanelPosition | null {
  try {
    const raw = localStorage.getItem(DRAG_POSITION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PanelPosition>
    if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null
    return { left: parsed.left, top: parsed.top }
  } catch {
    // 프라이빗 모드 등에서 localStorage가 막힐 수 있다. 기억 못 하는 것은 기능 실패가 아니다.
    return null
  }
}

function writeStoredPosition(position: PanelPosition): void {
  try {
    localStorage.setItem(DRAG_POSITION_STORAGE_KEY, JSON.stringify(position))
  } catch {
    // 저장 실패는 무시한다 — 이번 세션 동안은 그대로 동작한다.
  }
}

interface Props {
  sessionId: string
  /** 용어집 쿼리 키가 세션이 아니라 레슨 기준이라 따로 받는다. */
  lessonId: string
  /**
   * AI 질문 탭은 history를 한 번만 되살리고 이후로는 버린다(진행 중인 실제 대화를 늦게 온 조회가
   * 지우지 않으려는 설계 — PersonalAiQuestionPanel 참고). 그래서 여기서 기록을 바꿨으면 부모가
   * 그 컴포넌트를 새로 마운트하도록 알려야 실제로 화면에 반영된다.
   */
  onAiHistoryChanged: () => void
}

/**
 * 개발 전용 화면 조작 패널. 실 백엔드·라이브킷 없이 mock 상태(세션 상태·네 개 탭·자막 스트림)를
 * 화면에 붙은 그대로 흔들어, CSS·레이아웃을 고칠 때마다 로그인부터 다시 밟지 않아도 되게 한다.
 *
 * <p>채팅·자막처럼 WS로 오는 값은 mockLiveSessionService의 구독 콜백을 직접 호출해 흘린다 — 실제
 * 이벤트가 오는 경로와 같은 코드(머지·누적·스크롤)를 그대로 타므로 여기서 본 화면이 실제 트래픽에서도
 * 같게 보인다. 노트·용어집처럼 REST 조회 하나뿐인 값은 override를 바꾼 뒤 그 쿼리를 invalidate해
 * 반영한다. AI 기록만 한 단계 더 필요하다(applyAiHistory 참고).
 *
 * <p><b>네 탭(채팅·질문/실시간 노트/AI 질문/핵심 용어)은 이 패널이 마운트되는 순간 비운다.</b>
 * 이 mock이 원래 돌려주던 고정 데모 내용이 매번 미리 깔려 있으면, 지금 넣은 것과 원래 있던 것이
 * 섞여 화면이 무엇을 보여주는지 헷갈린다 — 빈 상태에서 시작해 필요한 것만 넣는 편이 검증하기 쉽다.
 * "샘플 데이터 추가"는 누를 때마다 새로 쌓인다(덮어쓰지 않는다) — 스크롤이 생길 만큼 여러 번 눌러도
 * 되고, "+10"으로 한 번에 채울 수도 있다. "초기화"는 그 탭만 다시 빈 상태로 되돌린다.
 * 다른 세션·다시보기는 이 override 밖이라 지금처럼 데모가 채워진 채로 열린다.
 *
 * `import.meta.env.DEV`가 아니면 렌더링하지 않아 프로덕션 번들에는 남지 않는다.
 */
export default function DevLivePanel({ sessionId, lessonId, onAiHistoryChanged }: Props) {
  const queryClient = useQueryClient()
  const [collapsed, setCollapsed] = useState(false)
  const [chatText, setChatText] = useState('')
  const [chatAsOther, setChatAsOther] = useState(true)
  const [chatIsQuestion, setChatIsQuestion] = useState(false)
  const [captionText, setCaptionText] = useState('')
  const [participantCount, setParticipantCount] = useState(12)

  /*
   * 기본 자리는 CSS(우하단 고정)가 정한다 — position이 null인 동안은 그대로 둔다.
   * 한 번이라도 끌면 그때부터 이 state의 절대 좌표(left/top)가 이긴다(useResizablePane과 같은 요령:
   * 픽셀 사이즈를 훅이 넘겨야 스크립트 없이도 레이아웃이 무너지지 않는다).
   */
  const panelRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<PanelPosition | null>(() => readStoredPosition())

  const handleGripPointerDown = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const panel = panelRef.current
    if (!panel) return
    event.preventDefault()
    const rect = panel.getBoundingClientRect()
    const startLeft = rect.left
    const startTop = rect.top
    const startX = event.clientX
    const startY = event.clientY
    const grip = event.currentTarget
    // 손잡이에 포인터를 붙잡아 둔다 — 안 하면 빠르게 끌었을 때 커서가 벗어나며 드래그가 끊긴다.
    grip.setPointerCapture(event.pointerId)

    const move = (moveEvent: PointerEvent) => {
      const maxLeft = Math.max(0, window.innerWidth - rect.width)
      const maxTop = Math.max(0, window.innerHeight - rect.height)
      setPosition({
        left: Math.min(maxLeft, Math.max(0, startLeft + (moveEvent.clientX - startX))),
        top: Math.min(maxTop, Math.max(0, startTop + (moveEvent.clientY - startY))),
      })
    }
    const end = () => {
      grip.removeEventListener('pointermove', move)
      grip.removeEventListener('pointerup', end)
      grip.removeEventListener('pointercancel', end)
      setPosition((current) => {
        if (current) writeStoredPosition(current)
        return current
      })
    }
    grip.addEventListener('pointermove', move)
    grip.addEventListener('pointerup', end)
    grip.addEventListener('pointercancel', end)
  }

  const panelStyle: CSSProperties | undefined = position
    ? { left: `${position.left}px`, top: `${position.top}px`, right: 'auto', bottom: 'auto' }
    : undefined

  /*
   * AI 기록은 invalidateQueries만으로는 화면에 반영되지 않는다(PersonalAiQuestionPanel이 history를
   * 한 번만 되살리고 그 뒤로는 무시하기 때문 — 위 onAiHistoryChanged 설명 참고). 그래서 이 값만은
   * ① override를 바꾸고 ② 결과를 직접 조회해 캐시에 동기적으로 심은 뒤 ③ 부모에게 재마운트를
   * 요청하는 순서를 지킨다. invalidateQueries(비동기 refetch)에 맡기면, 재마운트 시점에 아직
   * 갱신 전 값을 읽어 "초기화했는데 그대로"인 경합이 생긴다.
   */
  const applyAiHistory = async (mutate: () => void) => {
    mutate()
    const data = await getAiAnswerHistory(sessionId)
    queryClient.setQueryData(['ai-answers', sessionId], data)
    onAiHistoryChanged()
  }

  useEffect(() => {
    devResetChat(sessionId)
    devResetLectureNote(sessionId)
    devResetGlossary(lessonId)
    void queryClient.invalidateQueries({ queryKey: ['live-chat', sessionId] })
    void queryClient.invalidateQueries({ queryKey: ['lecture-notes', sessionId] })
    void queryClient.invalidateQueries({ queryKey: ['glossary', lessonId] })
    void applyAiHistory(() => devResetAiHistory(sessionId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, sessionId, lessonId])

  const setStatus = (status: CurriculumLiveSessionStatus) => {
    devSetLiveSessionStatusOverride(sessionId, status)
    queryClient.setQueryData<LiveSessionView>(
      ['live-session', sessionId],
      (cached) => cached ? { ...cached, status } : cached,
    )
  }

  const sendChat = (text: string) => {
    if (!text.trim()) return
    devPushChatMessage(sessionId, { text: text.trim(), mine: !chatAsOther, question: chatIsQuestion })
    setChatText('')
  }

  const sendCaption = (text: string) => {
    if (!text.trim()) return
    devPushCaptionLine(sessionId, text.trim())
    setCaptionText('')
  }

  /** 개발 도구 버튼 하나 = 목 상태 갱신 + 그 상태가 걸린 쿼리 무효화. 매번 같은 두 단계라 여기 모아 둔다. */
  const runAndInvalidate = (run: () => void, queryKey: unknown[]) => {
    run()
    void queryClient.invalidateQueries({ queryKey })
  }
  const appendTimes = (times: number, run: () => void, queryKey: unknown[]) => {
    for (let i = 0; i < times; i += 1) run()
    void queryClient.invalidateQueries({ queryKey })
  }

  const resetEverything = () => {
    runAndInvalidate(() => devResetChat(sessionId), ['live-chat', sessionId])
    runAndInvalidate(() => devResetLectureNote(sessionId), ['lecture-notes', sessionId])
    runAndInvalidate(() => devResetGlossary(lessonId), ['glossary', lessonId])
    void applyAiHistory(() => devResetAiHistory(sessionId))
  }

  return (
    <div className="dev-live-panel" ref={panelRef} style={panelStyle}>
      <div className="dev-live-panel__titlebar">
        {/* 드래그 전용 손잡이 — 접기/펼치기 버튼과 분리해 클릭이 드래그로 오해되지 않는다. */}
        <span
          className="dev-live-panel__grip"
          aria-hidden="true"
          title="끌어서 옮기기"
          onPointerDown={handleGripPointerDown}
        >
          ⠿
        </span>
        <button type="button" className="dev-live-panel__toggle" onClick={() => setCollapsed((current) => !current)}>
          🧪 {collapsed ? '개발 도구 펼치기' : '개발 도구 접기'}
        </button>
      </div>
      {!collapsed && (
        <div className="dev-live-panel__body">
          <section>
            <strong>전체</strong>
            <div className="dev-live-panel__row">
              <button type="button" onClick={resetEverything}>탭 4개 모두 초기화</button>
            </div>
          </section>

          <section>
            <strong>세션 상태</strong>
            <div className="dev-live-panel__row">
              {statusOptions.map((status) => (
                <button key={status} type="button" onClick={() => setStatus(status)}>{status}</button>
              ))}
            </div>
            <div className="dev-live-panel__row">
              <input
                type="number"
                min={0}
                value={participantCount}
                onChange={(event) => setParticipantCount(Number(event.target.value))}
              />
              <button type="button" onClick={() => devSetParticipantCount(sessionId, participantCount)}>접속자 수 반영</button>
            </div>
          </section>

          <section>
            <strong>채팅·질문</strong>
            <div className="dev-live-panel__row">
              <button type="button" onClick={() => runAndInvalidate(() => devAppendChatSample(sessionId), ['live-chat', sessionId])}>샘플 데이터 추가</button>
              <button type="button" onClick={() => appendTimes(10, () => devAppendChatSample(sessionId), ['live-chat', sessionId])}>+10</button>
              <button type="button" onClick={() => runAndInvalidate(() => devResetChat(sessionId), ['live-chat', sessionId])}>초기화</button>
            </div>
            <div className="dev-live-panel__row">
              <label><input type="checkbox" checked={chatAsOther} onChange={(event) => setChatAsOther(event.target.checked)} /> 다른 사람으로</label>
              <label><input type="checkbox" checked={chatIsQuestion} onChange={(event) => setChatIsQuestion(event.target.checked)} /> 질문</label>
            </div>
            <div className="dev-live-panel__row">
              <input
                value={chatText}
                placeholder="채팅 내용"
                onChange={(event) => setChatText(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') sendChat(chatText) }}
              />
              <button type="button" onClick={() => sendChat(chatText)}>보내기</button>
            </div>
            <div className="dev-live-panel__row">
              <button type="button" onClick={() => sendChat(longSampleText)}>긴 메시지 넣기</button>
            </div>
            <div className="dev-live-panel__row">
              {connectionOptions.map((state) => (
                <button key={state} type="button" onClick={() => devSetChatConnectionState(sessionId, state)}>{state}</button>
              ))}
            </div>
          </section>

          <section>
            <strong>실시간 노트</strong>
            <div className="dev-live-panel__row">
              <button type="button" onClick={() => runAndInvalidate(() => devAppendLectureNoteSample(sessionId), ['lecture-notes', sessionId])}>샘플 데이터 추가</button>
              <button type="button" onClick={() => appendTimes(10, () => devAppendLectureNoteSample(sessionId), ['lecture-notes', sessionId])}>+10</button>
              <button type="button" onClick={() => runAndInvalidate(() => devResetLectureNote(sessionId), ['lecture-notes', sessionId])}>초기화</button>
            </div>
          </section>

          <section>
            <strong>AI 질문</strong>
            <div className="dev-live-panel__row">
              <button type="button" onClick={() => void applyAiHistory(() => devAppendAiHistorySample(sessionId))}>샘플 데이터 추가</button>
              <button
                type="button"
                onClick={() => void applyAiHistory(() => {
                  for (let i = 0; i < 10; i += 1) devAppendAiHistorySample(sessionId)
                })}
              >
                +10
              </button>
              <button type="button" onClick={() => void applyAiHistory(() => devResetAiHistory(sessionId))}>초기화</button>
            </div>
          </section>

          <section>
            <strong>핵심 용어</strong>
            <div className="dev-live-panel__row">
              <button type="button" onClick={() => runAndInvalidate(() => devAppendGlossarySample(lessonId), ['glossary', lessonId])}>샘플 데이터 추가</button>
              <button type="button" onClick={() => appendTimes(10, () => devAppendGlossarySample(lessonId), ['glossary', lessonId])}>+10</button>
              <button type="button" onClick={() => runAndInvalidate(() => devResetGlossary(lessonId), ['glossary', lessonId])}>초기화</button>
            </div>
          </section>

          <section>
            <strong>자막</strong>
            <div className="dev-live-panel__row">
              <input
                value={captionText}
                placeholder="자막 내용"
                onChange={(event) => setCaptionText(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') sendCaption(captionText) }}
              />
              <button type="button" onClick={() => sendCaption(captionText)}>추가</button>
            </div>
            <div className="dev-live-panel__row">
              <button type="button" onClick={() => sendCaption(longSampleText)}>긴 자막 넣기</button>
            </div>
            <div className="dev-live-panel__row">
              {connectionOptions.map((state) => (
                <button key={state} type="button" onClick={() => devSetCaptionConnectionState(sessionId, state)}>{state}</button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
