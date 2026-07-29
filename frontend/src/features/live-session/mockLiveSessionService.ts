import { demoLiveCaptions, demoMessages, getDemoLiveSession } from '@/features/demo/demoData'
import { findMockLesson } from '@/features/demo/mockDatabase'
import type { CurriculumLiveSessionStatus } from '@/features/lesson/types'
import type { LiveSessionService } from './liveSessionService.interface'

const liveStatusOverrides = new Map<string, CurriculumLiveSessionStatus>()
const liveStartOperations = new Map<string, string>()
const bookmarksByLesson = new Map<string, number[]>()
const mockLivePlaybackUrl = 'https://files.vidstack.io/sprite-fight/hls/stream.m3u8'

export const mockLiveSessionService = {
  async getLiveSession(sessionId) {
    const session = getDemoLiveSession(sessionId)
    const status = liveStatusOverrides.get(sessionId) ?? session.status
    return {
      ...session,
      status,
      participants: status === 'LIVE' ? Math.max(session.participants, 1) : 0,
      entryWindowMinutes: 10,
    }
  },
  async getPlayback(lessonId) {
    // 실 API가 레슨의 라이브 세션을 찾아 응답에 싣듯, 목도 데모 데이터에서 세션을 찾는다.
    const liveSession = findMockLesson(lessonId)?.lesson.liveSession
    return {
      lessonId,
      sessionId: liveSession?.sessionId ?? `ses-mock-${lessonId}`,
      liveSessionStatus: liveSession?.status ?? 'LIVE',
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
    liveStatusOverrides.set(sessionId, 'ENDED')
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
  async sendChatMessage(_sessionId, text, question) {
    return { id: `msg_${Date.now()}`, alias: '나', text, time: '현재', question }
  },
  subscribeChatMessages(_sessionId, _onMessage, onConnectionChange) {
    onConnectionChange('connected')
    return () => onConnectionChange('disconnected')
  },
  subscribeCaptions(_sessionId, onEvent, onConnectionChange) {
    onConnectionChange('connected')
    // 데모 자막을 델타 스트림 형태로 흉내 낸다: 각 데모 라인을 한 sttSession으로 흘리고,
    // 마지막 라인은 completed 없이 남겨 "진행 중(pending)" 라이브 라인을 보여 준다.
    const occurredAt = new Date().toISOString()
    demoLiveCaptions.forEach((caption, index) => {
      const sttSessionId = `mock-stt-${index}`
      onEvent({
        type: 'caption.delta',
        occurredAt,
        // 데모 startMs는 세션 축(12:08=728s)이라 sessionMs로도 실어 학생 위치 동기화가 동작하게 한다.
        payload: { sttSessionId, sequence: 1, streamElapsedMs: caption.startMs, sessionMs: caption.startMs, text: caption.text },
      })
      if (index < demoLiveCaptions.length - 1) {
        onEvent({
          type: 'caption.stream.completed',
          occurredAt,
          payload: { sttSessionId, lastSequence: 1, reason: 'ROOM_DELETED' },
        })
      }
    })
    return () => onConnectionChange('disconnected')
  },
  async getCaptions() {
    // 리로드는 WS 델타와 같은 스트림 이벤트로 시드된다. sttSessionId·sequence를 subscribeCaptions와
    // 동일하게(`mock-stt-${index}`) 둬 실제 BE처럼 WS 델타와 멱등 병합되게 한다(중복 라인 방지).
    const occurredAt = new Date().toISOString()
    return demoLiveCaptions.map((caption, index) => ({
      type: 'caption.delta' as const,
      occurredAt,
      payload: {
        sttSessionId: `mock-stt-${index}`,
        sequence: 1,
        streamElapsedMs: caption.startMs,
        sessionMs: caption.startMs,
        text: caption.text,
      },
    }))
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
  async getProcessingStatus() {
    return {
      steps: [
        { label: '녹화 종료 요청', status: 'COMPLETE' as const },
        { label: 'HLS 세그먼트 정리', status: 'COMPLETE' as const },
        { label: '재생 가능성 검증', status: 'COMPLETE' as const },
        { label: '다시보기 검수 준비', status: 'PROCESSING' as const },
      ],
      ready: false,
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
