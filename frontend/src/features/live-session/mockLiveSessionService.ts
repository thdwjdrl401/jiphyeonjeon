import { demoLiveCaptions, demoMessages, getDemoLiveSession } from '@/features/demo/demoData'
import { findMockLesson, findMockLiveSession } from '@/features/demo/mockDatabase'
import type { CurriculumLiveSessionStatus } from '@/features/lesson/types'
import {
  publishRecordingReady,
  publishVodPublished,
} from '@/features/notification/mockNotificationEvents'
import type {
  LiveSessionService,
  LiveSessionStateEvent,
  LiveSessionView,
} from './liveSessionService.interface'

const liveStatusOverrides = new Map<string, CurriculumLiveSessionStatus>()
const liveStartOperations = new Map<string, string>()
const bookmarksByLesson = new Map<string, number[]>()
const processingPollCounts = new Map<string, number>()
const stateSubscribers = new Map<string, Set<(event: LiveSessionStateEvent) => void>>()
const mockLivePlaybackUrl = 'https://files.vidstack.io/sprite-fight/hls/stream.m3u8'

/**
 * 모듈 상태 초기화. 위 Map들은 한 번 쓰이면 프로세스가 끝날 때까지 남는다 — 라이브를 시작하는
 * 테스트가 세션을 LIVE로 바꿔 두면 <b>그 뒤에 도는 다른 테스트</b>가 SCHEDULED를 기대하다 깨진다.
 * 지금까지는 파일 안 테스트 순서가 우연히 맞아 가려져 있었고, 순서를 섞으면 바로 재현됐다.
 * {@code resetMockAuth}가 데모 상태를 되돌릴 때 함께 부른다.
 *
 * <p>종료 상태 구독자(`stateSubscribers`)도 함께 지운다 — 남겨 두면 이전 테스트가 붙여 둔 구독자가
 * 다음 테스트의 이벤트를 받아 엉뚱한 화면 전환을 만든다.
 */
export function resetMockLiveSessions() {
  liveStatusOverrides.clear()
  liveStartOperations.clear()
  bookmarksByLesson.clear()
  processingPollCounts.clear()
  stateSubscribers.clear()
}

async function getMockLiveSession(sessionId: string): Promise<LiveSessionView> {
  const session = getDemoLiveSession(sessionId)
  const status = liveStatusOverrides.get(sessionId) ?? session.status
  return {
    ...session,
    status,
    participants: status === 'LIVE' ? Math.max(session.participants, 1) : 0,
    entryWindowMinutes: 10,
  }
}

export const mockLiveSessionService = {
  getLiveSession: getMockLiveSession,
  async getPlayback(lessonId) {
    // 실 API가 레슨의 라이브 세션을 찾아 응답에 싣듯, 목도 데모 데이터에서 세션을 찾는다.
    const liveSession = findMockLesson(lessonId)?.lesson.liveSession
    return {
      lessonId,
      sessionId: liveSession?.sessionId ?? `ses-mock-${lessonId}`,
      liveSessionStatus: liveSession?.status ?? 'LIVE',
      replayStatus: liveSession?.status === 'ENDED' ? 'PUBLISHED' as const : 'DRAFT' as const,
      currentSessionMs: null,
      durationMs: null,
      source: { url: mockLivePlaybackUrl, availableFromMs: 0, availableToMs: null },
    }
  },
  async preparePreflightRoom(sessionId) {
    return { sessionId, roomName: `session-${sessionId}`, roomSid: `RM_${sessionId}` }
  },
  async getPreflightReadiness() {
    return {
      ready: true,
      instructorPresent: true,
      microphonePublished: true,
      microphoneMuted: false,
      instructorMicrophoneTrackCount: 1,
      unexpectedMicrophonePublishers: 0,
    }
  },
  async startLiveSession(sessionId) {
    const operationId = liveStartOperations.get(sessionId) ?? `op-${sessionId}`
    liveStartOperations.set(sessionId, operationId)
    liveStatusOverrides.set(sessionId, 'STARTING')
    return { operationId, sessionId, status: 'STARTING' as const }
  },
  async getLiveStartStatus(sessionId) {
    const operationId = liveStartOperations.get(sessionId) ?? null
    liveStatusOverrides.set(sessionId, 'LIVE')
    const demo = getDemoLiveSession(sessionId)
    const session = {
      ...demo,
      status: 'LIVE' as const,
      participants: Math.max(demo.participants, 1),
      entryWindowMinutes: 10,
    }
    return {
      operationId,
      attemptStatus: 'SUCCEEDED' as const,
      step: 'LIVE' as const,
      failureCode: null,
      failureMessage: null,
      session,
    }
  },
  async endLiveSession(sessionId) {
    liveStatusOverrides.set(sessionId, 'ENDING')
    stateSubscribers.get(sessionId)?.forEach((subscriber) => subscriber({
      type: 'session.ending',
      occurredAt: new Date().toISOString(),
      payload: { liveSessionStatus: 'ENDING', endedAt: null },
    }))
    liveStatusOverrides.set(sessionId, 'ENDED')
    const endedAt = new Date().toISOString()
    stateSubscribers.get(sessionId)?.forEach((subscriber) => subscriber({
      type: 'session.ended',
      occurredAt: endedAt,
      payload: { liveSessionStatus: 'ENDED', endedAt },
    }))
    return getMockLiveSession(sessionId)
  },
  async getInstructorLiveToken(sessionId) {
    return { token: `mock-token-${sessionId}` }
  },
  async getParticipants() {
    return [
      { alias: '수강생-14A2', state: '시청 중', joinedAt: '09:52' },
      { alias: '수강생-09C1', state: 'DVR · 2분 전', joinedAt: '09:55' },
      { alias: '수강생-21B3', state: '시청 중', joinedAt: '10:03' },
    ]
  },
  async getChatMessages() {
    return demoMessages
  },
  async sendChatMessage(_sessionId, input) {
    // 익명을 켜면 서버가 세션 한정 가명을 붙인다 — 데모도 같은 모양으로 흉내 낸다(ADR-0050).
    return {
      id: `msg_${Date.now()}`,
      clientMessageId: input.clientMessageId,
      alias: input.anonymous ? '수강생-0473' : '김학생',
      text: input.text,
      time: '현재',
      question: input.question,
      mine: true,
    }
  },
  subscribeChatMessages(_sessionId, _onMessage, onConnectionChange) {
    onConnectionChange('connected')
    return () => onConnectionChange('disconnected')
  },
  subscribeSessionState(sessionId, onEvent, onConnectionChange) {
    const subscribers = stateSubscribers.get(sessionId) ?? new Set()
    subscribers.add(onEvent)
    stateSubscribers.set(sessionId, subscribers)
    onConnectionChange('connected')
    // 서버도 구독 직후 현재 인원을 한 번 보낸다 — 목이 이걸 빠뜨리면 접속자 수가 목에서만 0이 된다.
    onEvent({
      type: 'session.presence',
      occurredAt: new Date().toISOString(),
      payload: { participantCount: getDemoLiveSession(sessionId).participants },
    })
    return () => {
      subscribers.delete(onEvent)
      if (subscribers.size === 0) stateSubscribers.delete(sessionId)
      onConnectionChange('disconnected')
    }
  },
  subscribeCaptions(_sessionId, onEvent, onConnectionChange) {
    onConnectionChange('connected')
    // 데모 자막을 델타 + 확정 세그먼트 스트림으로 흉내 낸다: 각 데모 라인을 한 sttSession으로 흘리되,
    // 델타(진행 중) 뒤에 caption.segment.final(권위 있는 확정 텍스트)로 마감한다. 마지막 라인은 세그먼트·
    // completed 없이 델타만 남겨 "진행 중(pending)" 라이브 조각을 보여 준다.
    const occurredAt = new Date().toISOString()
    demoLiveCaptions.forEach((caption, index) => {
      onEvent({
        type: 'caption.delta',
        occurredAt,
        // 데모 startMs는 세션 축(12:08=728s)이라 sessionMs로도 실어 진행 중 조각의 위치 동기화가 동작하게 한다.
        payload: { sttSessionId: `mock-stt-${index}`, sequence: 1, streamElapsedMs: caption.startMs, sessionMs: caption.startMs, text: caption.text },
      })
      if (index < demoLiveCaptions.length - 1) {
        onEvent({
          type: 'caption.segment.final',
          occurredAt,
          payload: {
            sttSessionId: `mock-stt-${index}`,
            segmentIndex: 0,
            lastSequence: 1,
            text: caption.text,
            startStreamElapsedMs: caption.startMs,
            endStreamElapsedMs: caption.endMs,
            boundaryReason: 'SILENCE',
            sessionMs: caption.startMs,
          },
        })
        onEvent({
          type: 'caption.stream.completed',
          occurredAt,
          payload: { sttSessionId: `mock-stt-${index}`, lastSequence: 1, reason: 'ROOM_DELETED' },
        })
      }
    })
    return () => onConnectionChange('disconnected')
  },
  async getCaptions() {
    // 리로드는 WS와 같은 스트림 이벤트로 시드된다. sttSessionId·sequence·segmentIndex를 subscribeCaptions와
    // 동일하게 둬 실제 BE처럼 WS 이벤트와 멱등 병합되게 한다(중복 라인 방지). 확정 라인은 segment.final로,
    // 마지막 진행 중 라인은 델타로만 시드한다.
    const occurredAt = new Date().toISOString()
    return demoLiveCaptions.flatMap((caption, index) => {
      const delta = {
        type: 'caption.delta' as const,
        occurredAt,
        payload: {
          sttSessionId: `mock-stt-${index}`,
          sequence: 1,
          streamElapsedMs: caption.startMs,
          sessionMs: caption.startMs,
          text: caption.text,
        },
      }
      if (index === demoLiveCaptions.length - 1) return [delta]
      return [
        delta,
        {
          type: 'caption.segment.final' as const,
          occurredAt,
          payload: {
            sttSessionId: `mock-stt-${index}`,
            segmentIndex: 0,
            lastSequence: 1,
            text: caption.text,
            startStreamElapsedMs: caption.startMs,
            endStreamElapsedMs: caption.endMs,
            boundaryReason: 'SILENCE' as const,
            sessionMs: caption.startMs,
          },
        },
      ]
    })
  },
  // 목도 스트리밍 UX를 그대로 재현한다 — 델타를 조각내 흘린 뒤 근거를 실은 answer.done으로 끝낸다.
  // 한 번에 완성 문장을 주면 "누적 렌더·전송 중 비활성·취소"가 목 모드에서 아예 검증되지 않는다.
  // 근거 없는 질문은 answer.insufficient로 끝내 오류가 아닌 별도 상태도 화면에서 볼 수 있게 한다.
  async askLiveAi(sessionId, question, { onEvent, signal }) {
    const requestId = `req-mock-${Date.now()}`
    const insufficient = question.includes('점심')
    const chunks = insufficient
      ? []
      : [
          'SecurityContext는 인증이 끝난 현재 요청의 사용자 정보를 보관합니다. ',
          '세션 저장소와는 책임이 다르며, ',
          '요청이 끝나면 컨텍스트가 정리됩니다.',
        ]

    for (const text of chunks) {
      await new Promise((resolve) => setTimeout(resolve, 120))
      if (signal?.aborted) return
      onEvent({ type: 'answer.delta', payload: { requestId, text } })
    }

    await new Promise((resolve) => setTimeout(resolve, 120))
    if (signal?.aborted) return

    if (insufficient) {
      onEvent({
        type: 'answer.insufficient',
        payload: { requestId, message: '이 질문에 답할 근거를 강의 자료와 발화에서 찾지 못했습니다.' },
      })
      return
    }

    onEvent({
      type: 'answer.done',
      payload: {
        requestId,
        sources: [
          { type: 'PPTX', materialId: 'mat-session-and-csrf', page: 12 },
          // CAPTION의 시각은 STT attempt-local 축이다(세션-ms 아님) — 목도 같은 축으로 준다.
          { type: 'CAPTION', sessionId, sttSessionId: 'stt-mock-1', startMs: 728_000, endMs: 761_000 },
        ],
      },
    })
  },
  async saveBookmark(lessonId, sessionMs) {
    const bookmarks = bookmarksByLesson.get(lessonId) ?? []
    bookmarksByLesson.set(lessonId, [...bookmarks, sessionMs])
  },
  async getAiAnswerHistory() {
    // 목도 서버와 같은 모양을 돌려준다 — 목이 다르면 실서버에서만 깨지는 화면이 된다.
    return [
      {
        requestId: 'req-mock-1',
        question: '세션과 JWT를 함께 쓰는 기준이 뭔가요?',
        answer: '세션은 서버가 상태를 들고, JWT는 토큰 자체가 상태를 나릅니다.',
        sources: '[]',
        status: 'DONE' as const,
        failureCode: null,
        askedAt: '2026-08-02T21:00:00+09:00',
      },
    ]
  },
  async getGlossary() {
    return [
      {
        termId: 'SecurityContext',
        term: 'SecurityContext',
        definition: '현재 요청에서 인증된 사용자와 권한 정보를 보관하는 컨테이너입니다.',
        source: 'MATERIAL' as const,
      },
      {
        termId: 'SecurityFilterChain',
        term: 'SecurityFilterChain',
        definition: '요청에 순서대로 적용할 보안 필터 묶음입니다.',
        source: 'INSTRUCTOR' as const,
      },
    ]
  },
  async getMyWatchBuckets() {
    return { 0: 1, 1: 1, 2: 3, 3: 1 }
  },
  async reportWatchBuckets() {
    // 목은 저장하지 않는다 — 화면이 전송 실패로 흔들리지 않게 조용히 성공한다.
  },
  async getWatchHeatmap() {
    // 서버와 같은 모양. 2.4가 가장 많이 다시 본 구간이다.
    return {
      bucketSizeMs: 10000,
      points: [1, 1, 1.2, 2.4, 1.8, 1, 1, 1.1, 1, 1],
      viewers: 5,
    }
  },
  async getLectureNotes() {
    // 목도 서버와 같은 모양을 돌려준다 — 목이 다르면 실서버에서만 깨지는 화면이 된다.
    return {
      coveredThroughSequence: 21,
      topics: [
        {
          topicId: 'topic-1',
          title: '요청이 인증되는 전체 흐름',
          keyPoints: [
            'HTTP 요청은 보안 필터 체인을 먼저 통과합니다.',
            '인증 성공 결과는 현재 요청의 보안 컨텍스트에 저장됩니다.',
          ],
        },
        {
          topicId: 'topic-2',
          title: 'SecurityContext의 책임',
          keyPoints: ['SecurityContext는 현재 실행 흐름의 인증 정보를 제공합니다.'],
        },
      ],
      markdown: '## 요청이 인증되는 전체 흐름\n- HTTP 요청은 보안 필터 체인을 먼저 통과합니다.',
      status: 'CAPTURING' as const,
      updatedAt: '2026-08-02T21:00:00+09:00',
    }
  },
  subscribeLectureNotes(_sessionId, _onNote, onConnectionChange) {
    onConnectionChange('connected')
    return () => onConnectionChange('disconnected')
  },
  async getProcessingStatus(sessionId) {
    // 서버와 같은 모양으로 돌려준다 — 목이 화면 문구를 만들어 주면 실서버에서만 깨지는 화면이 된다.
    const pollCount = (processingPollCounts.get(sessionId) ?? 0) + 1
    processingPollCounts.set(sessionId, pollCount)
    const ready = pollCount >= 2
    if (ready) {
      /*
        녹화가 READY로 넘어가는 순간이 알림의 방아쇠다. 서버에서는 Egress COMPLETE webhook이
        같은 자리에 있고, 그 webhook은 재전송될 수 있다 — 여기서도 폴링마다 다시 들어오지만
        중복 방지 키가 같아 알림은 한 건만 남는다.

        학생용 다시보기 알림을 함께 만드는 이유: 현재 서버는 새 정상 녹화를 READY와 동시에
        게시한다(`RecordingService.markReady`가 DRAFT → PUBLISHED). 즉 이 시점이 "학생에게
        공개된" 시점이기도 하다. 강사 검수 후 게시로 흐름이 바뀌면 이 줄을 지우고
        `publishReplayReview`만 남기면 된다.
      */
      publishRecordingReady(sessionId)
      const found = findMockLiveSession(sessionId)
      // 목차상 실제로 공개된 다시보기만 알린다 — 미게시·철회 자산은 학생 알림을 만들지 않는다.
      if (found?.lesson.replayStatus === 'PUBLISHED') publishVodPublished(found.lesson.lessonId)
    }
    return {
      sessionId,
      liveSessionStatus: 'ENDED' as const,
      recordingEnabled: true,
      startedAt: '2026-08-01T10:00:00+09:00',
      endedAt: '2026-08-01T11:32:00+09:00',
      videoAsset: {
        videoAssetId: 'vid_mock_0001',
        status: ready ? 'READY' as const : 'FINALIZING' as const,
        replayStatus: ready ? 'PUBLISHED' as const : 'DRAFT' as const,
        failureCode: null,
        durationMs: ready ? 5_520_000 : null,
        sizeBytes: ready ? 1_284_000_000 : null,
        recordingStartedAt: '2026-08-01T10:00:04+09:00',
        recordingEndedAt: '2026-08-01T11:32:06+09:00',
      },
    }
  },
  async getQuestionHighlights() {
    return [
      { at: '12:18', count: 3, text: '세션과 JWT를 함께 사용하는 기준이 궁금해요.' },
      { at: '27:40', count: 5, text: '필터 순서가 실제 인증에 어떤 영향을 주나요?' },
      { at: '41:05', count: 2, text: 'Redis 장애 시 세션 복구 방식이 궁금해요.' },
    ]
  },
} satisfies LiveSessionService
