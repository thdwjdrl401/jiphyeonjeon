# VOD·학습·게시 콘텐츠·AI·퀴즈 API

> 공통 규칙: [API_MAP.md](../API_MAP.md) · 화면 명세: [VOD_LESSON.md](../components/VOD_LESSON.md) · 공유 계약: [CONTRACT.md](../../CONTRACT.md)

## 1. 범위

라이브 Egress HLS 다시보기, 학습 진도, 교정 자막·전문용어·챕터·근거, 시간 동기화 채팅 리플레이, 개인 AI Q&A, 북마크, 퀴즈, 강사 검수·게시와 익명 학습 통계 API를 정의한다.

### 1.1 확정 원칙

- VOD는 라이브 Egress 녹화 HLS만 사용하며 영상 업로드는 없음
- `videoAssetStatus=READY`와 `replayStatus=PUBLISHED`를 분리
- 강사는 자산 `READY`부터 미리보기·검수 가능
- 수강생은 replay `PUBLISHED` 이후 재생 가능
- 영상은 AI 콘텐츠 게시 여부와 독립적으로 공개 가능
- AI 원본·후보는 자동 게시하지 않고 강사 검수 후 core 게시본 생성
- AI 원본은 보존하고 게시본은 영역별 version 관리
- 채팅 리플레이는 가명·시간 동기화·읽기 전용
- 개인 AI Q&A는 본인만 조회하고 강사에게 질문 원문·시점만 익명 집계
- 진행률은 서버가 유효 시청량을 기준으로 90% 완료 판정
- 퀴즈는 검수·게시 후 별도 패널에서 응시하며 서버가 결정론 채점

## 2. API 목록

### 2.1 재생·학습 context

| ID | Method | Path | 설명 | 상태 |
|---|---|---|---|---|
| `VOD-01` | `GET` | `/api/v1/lessons/{lessonId}/learning-context` | VOD 화면 초기 context | URL **확정** |
| `VOD-02` | `GET` | `/api/v1/lessons/{lessonId}/playback` | 권한 적용 HLS URL 발급 | URL **확정** |
| `PROGRESS-01` | `PUT` | `/api/v1/lessons/{lessonId}/progress` | 마지막 위치·유효 시청 구간 저장 | URL **확정** |
| `BOOKMARK-01` | `GET/POST` | `/api/v1/lessons/{lessonId}/bookmarks` | 내 북마크 조회·생성 | URL 계열 **확정** |
| `BOOKMARK-02` | `DELETE` | `/api/v1/lessons/{lessonId}/bookmarks/{bookmarkId}` | 내 북마크 삭제 | **제안** |

### 2.2 게시 콘텐츠·채팅·AI

| ID | Method | Path | 설명 | 상태 |
|---|---|---|---|---|
| `TRANSCRIPT-01` | `GET` | `/api/v1/lessons/{lessonId}/transcript` | 게시 자막 조회·검색 | URL **확정** |
| `GLOSSARY-01` | `GET` | `/api/v1/lessons/{lessonId}/glossary` | 게시 전문용어 조회 | URL **확정** |
| `CHAPTER-01` | `GET` | `/api/v1/lessons/{lessonId}/chapters` | 게시 챕터·구조 요약 조회 | **제안** |
| `CHAT-REPLAY-01` | `GET` | `/api/v1/lessons/{lessonId}/messages` | 저장 채팅 리플레이 | URL **확정** |
| `AI-HISTORY-01` | `GET` | `/api/v1/lessons/{lessonId}/ai/questions` | 본인 AI Q&A 기록 | **제안** |
| `AI-QUESTION-01` | `POST/SSE` | `/api/v1/lessons/{lessonId}/ai/questions:stream` | 현재 시점 개인 AI 질문 | URL **확정** |

### 2.3 퀴즈

| ID | Method | Path | 설명 | 상태 |
|---|---|---|---|---|
| `QUIZ-01` | `GET` | `/api/v1/lessons/{lessonId}/quizzes` | 현재 게시 퀴즈와 내 최신 결과 | URL **확정** |
| `QUIZ-02` | `POST` | `/api/v1/quizzes/{quizId}/attempts` | 응시 제출·결정론 채점 | URL **확정** |
| `QUIZ-03` | `GET` | `/api/v1/quizzes/{quizId}/attempts/me` | 내 응시 이력 | **제안** |

### 2.4 강사 replay·콘텐츠 검수·통계

| ID | Method | Path | 설명 | 상태 |
|---|---|---|---|---|
| `REPLAY-01` | `POST` | `/api/v1/instructor/lessons/{lessonId}/replay/publish` | VOD 영상 수강생 공개 | **제안** |
| `REPLAY-02` | `POST` | `/api/v1/instructor/lessons/{lessonId}/replay/withdraw` | 신규 VOD 재생 공개 중단 | **제안** |
| `REVIEW-01` | `GET` | `/api/v1/instructor/lessons/{lessonId}/reviews` | 영역별 후보·초안·게시본·상태 | **제안** |
| `REVIEW-02` | `PUT` | `/api/v1/instructor/lessons/{lessonId}/reviews/{contentType}/draft` | 검수 초안 저장 | **제안** |
| `REVIEW-03` | `POST` | `/api/v1/instructor/lessons/{lessonId}/reviews/{contentType}/publish` | 새 게시본 version 생성·활성화 | **제안** |
| `QUESTION-STATS-01` | `GET` | `/api/v1/instructor/lessons/{lessonId}/question-pins` | 라이브·VOD 익명 질문 집계 | **제안** |
| `QUESTION-STATS-02` | `GET` | `/api/v1/instructor/lessons/{lessonId}/question-pins/{pinId}/questions` | 익명 질문 원문 | **제안** |
| `LEARNING-STATS-01` | `GET` | `/api/v1/instructor/lessons/{lessonId}/learning-summary` | 재생·완료·퀴즈 집계 | **제안** |

## 3. `VOD-01` 초기 학습 context

```http
GET /api/v1/lessons/{lessonId}/learning-context
```

재생 URL과 대용량 자막·채팅을 제외한 페이지 조합 정보를 반환한다.

```json
{
  "lesson": {
    "lessonId": "les_01J...",
    "title": "Spring Security 시작하기",
    "description": "인증과 인가의 기본을 다룹니다.",
    "courseId": "crs_01J...",
    "courseTitle": "실시간 Spring 입문",
    "sectionId": "sec_01J...",
    "sectionTitle": "2. 인증과 인가",
    "previousLessonId": "les_01A...",
    "nextLessonId": "les_01K..."
  },
  "sourceSession": {
    "sessionId": "ses_01J...",
    "startedAt": "2026-08-01T10:00:00+09:00",
    "durationMs": 5400000
  },
  "videoAssetStatus": "READY",
  "replayStatus": "PUBLISHED",
  "contentPublications": {
    "transcript": {"status": "PUBLISHED", "version": 2},
    "glossary": {"status": "PUBLISHED", "version": 1},
    "chapters": {"status": "PUBLISHED", "version": 1},
    "quiz": {"status": "PUBLISHED", "version": 3}
  },
  "materials": [
    {
      "materialId": "mat_01J...",
      "originalFileName": "security-basics.pptx",
      "fileSize": 3512345,
      "order": 1,
      "downloadAvailable": true
    }
  ],
  "learningProgress": {
    "lastPositionMs": 125000,
    "progressPercent": 35,
    "completed": false,
    "updatedAt": "2026-08-02T10:00:00+09:00"
  },
  "viewerContext": {
    "relationship": "ENROLLED",
    "allowedActions": ["PLAY_REPLAY", "UPDATE_PROGRESS", "ASK_AI", "TAKE_QUIZ"]
  }
}
```

- 강사에게는 `REVIEW_CONTENT`, `PUBLISH_REPLAY`, `WITHDRAW_REPLAY`, `VIEW_LEARNING_SUMMARY` 같은 행동을 추가한다.
- 수강생 context는 현재 활성 게시본 version만 제공한다.
- 강사에게 후보 전체를 이 context에 넣지 않고 `REVIEW-01`에서 별도 조회한다.
- AI 영역 일부가 준비되지 않아도 영상 재생 가능 여부를 막지 않는다.

## 4. `VOD-02` HLS 재생 정보

```http
GET /api/v1/lessons/{lessonId}/playback
```

```json
{
  "lessonId": "les_01J...",
  "videoAssetId": "vid_01J...",
  "hlsUrl": "https://media.example.com/vod/master.m3u8?...",
  "expiresAt": "2026-08-02T10:10:00+09:00",
  "durationMs": 5400000,
  "sessionTimeOffsetMs": 0,
  "contentType": "application/vnd.apple.mpegurl"
}
```

### 4.1 권한

- 강사: `videoAssetStatus=READY`이면 replay 게시 전에도 미리보기 가능
- 수강생: 활성 enrollment, lesson `PUBLISHED`, replay `PUBLISHED` 모두 검증
- 다른 강사·비수강·비로그인은 URL 미발급
- URL은 짧은 만료 시간을 가지며 재생 중 만료 시 같은 endpoint로 재발급

### 4.2 오류

| 상태 | 오류 코드 예시 | 의미 |
|---|---|---|
| `403` | `REPLAY_ACCESS_FORBIDDEN` | 재생 권한 없음 |
| `404` | `REPLAY_NOT_FOUND` | 존재 은닉 또는 자산 없음 |
| `409` | `VIDEO_ASSET_NOT_READY` | finalizing·verifying 중 |
| `409` | `REPLAY_NOT_PUBLISHED` | 수강생 공개 전 |
| `410` | `PLAYBACK_URL_EXPIRED` | 이미 발급한 URL의 media gate에서 사용할지 협의 |

## 5. 학습 진도

### 5.1 `PROGRESS-01`

```http
PUT /api/v1/lessons/{lessonId}/progress
```

```json
{
  "lastPositionMs": 185000,
  "watchedRanges": [
    {"startMs": 125000, "endMs": 185000}
  ],
  "playbackSessionId": "pbs_01J...",
  "clientUpdatedAt": "2026-08-02T10:02:00+09:00"
}
```

```json
{
  "lastPositionMs": 185000,
  "progressPercent": 37,
  "completed": false,
  "completedAt": null,
  "updatedAt": "2026-08-02T10:02:01+09:00"
}
```

- 일정 주기·일시정지·탭 이탈·페이지 이탈 시 저장
- 요청 실패가 영상 재생을 중단하지 않음
- 서버가 겹치는 watched range를 병합하고 유효 시청량을 계산
- 탐색으로 가장 먼 위치에 이동한 것만으로 완료 처리하지 않음
- 서버가 90% 기준을 적용해 `completed` 판정
- out-of-order 요청이 이전 위치로 덮어쓰지 않도록 `clientUpdatedAt` 또는 sequence 정책 필요

`watchedRanges` 악용 방지와 유효 시청 기준은 백엔드 정책이 소유한다. 초기 CP에서 range 추적이 과도하면 last position부터 구현하되 완료 판정 정확도 한계를 명시한다.

## 6. 게시 자막·전문용어·챕터

### 6.1 자막 조회와 검색

```http
GET /api/v1/lessons/{lessonId}/transcript?fromMs=0&toMs=600000
GET /api/v1/lessons/{lessonId}/transcript?q=security&page=0&size=50
```

```json
{
  "version": 2,
  "segments": [
    {
      "segmentId": "cap_01J...",
      "startMs": 118000,
      "endMs": 121000,
      "text": "Spring Security를 시작합니다."
    }
  ]
}
```

검색 응답은 결과 segment와 앞뒤 문맥을 제공한다. 전체 자막을 한 번에 반환할지 시간 범위·cursor 조회로 나눌지는 예상 길이를 기준으로 협의한다.

### 6.2 전문용어

```http
GET /api/v1/lessons/{lessonId}/glossary
```

```json
{
  "version": 1,
  "terms": [
    {
      "termId": "trm_01J...",
      "term": "SecurityFilterChain",
      "description": "HTTP 보안 필터의 실행 체인을 정의합니다.",
      "occurrences": [{"startMs": 118000, "endMs": 121000}],
      "evidence": [
        {
          "type": "MATERIAL",
          "materialId": "mat_01J...",
          "fileName": "security-basics.pptx",
          "slideNumber": 12,
          "excerpt": "SecurityFilterChain ...",
          "sessionMs": 116000
        }
      ]
    }
  ]
}
```

### 6.3 챕터

```http
GET /api/v1/lessons/{lessonId}/chapters
```

```json
{
  "version": 1,
  "chapters": [
    {
      "chapterId": "chp_01J...",
      "title": "인증과 인가의 차이",
      "description": "두 개념과 처리 흐름을 설명합니다.",
      "startMs": 90000,
      "endMs": 240000,
      "order": 1
    }
  ]
}
```

수강생에게 후보·초안·비활성 version을 노출하지 않는다. 게시본이 없으면 `200` 빈 데이터와 publication status 또는 `204` 중 하나로 통일한다.

## 7. 채팅 리플레이

```http
GET /api/v1/lessons/{lessonId}/messages?sessionId={sessionId}&fromSessionMs=0&toSessionMs=300000&page=0&size=200
```

```json
{
  "items": [
    {
      "messageId": "msg_01J...",
      "sessionMs": 120500,
      "text": "이 부분을 다시 설명해 주세요.",
      "isQuestion": true,
      "alias": "수강생 12"
    }
  ],
  "page": 0,
  "size": 200,
  "totalElements": 20
}
```

- 라이브 당시 가명 유지
- 삭제·제재된 메시지 제외 또는 tombstone 정책 적용
- VOD에서는 `POST`를 제공하지 않고 조회만 사용
- 영상 탐색 시 해당 `sessionMs`까지 재구성할 수 있도록 범위·페이지 조회 지원
- 내부 userId와 실명은 반환하지 않음

## 8. 개인 AI Q&A

### 8.1 기록 조회

```http
GET /api/v1/lessons/{lessonId}/ai/questions?page=0&size=20
```

```json
{
  "items": [
    {
      "questionId": "qst_01J...",
      "sessionMs": 118000,
      "question": "SecurityFilterChain이 무엇인가요?",
      "answer": "...",
      "status": "ANSWERED",
      "citations": [],
      "createdAt": "2026-08-01T10:02:00+09:00"
    }
  ],
  "page": 0,
  "size": 20,
  "totalElements": 3
}
```

현재 로그인 사용자의 기록만 반환한다. 라이브·VOD 질문을 같은 레슨 기록으로 합치고 `sessionMs`를 유지한다.

### 8.2 새 질문

라이브와 같은 `POST /ai/questions:stream` SSE 계약을 사용한다. VOD에서는 현재 활성 자막·PPTX와 `sessionMs`를 scope로 사용하고, 근거 선택 시 해당 영상 시각으로 이동할 수 있어야 한다.

게시본 version이 질문 도중 바뀌더라도 질문 시작 시점 version으로 응답을 완료한다. `meta` event에 사용 version을 포함한다.

## 9. 북마크

라이브 문서의 북마크 계약을 그대로 사용한다.

- 라이브에서 만든 북마크도 같은 `lessonId`, `sessionMs`로 조회
- VOD에서 현재 시점 북마크 추가
- 목록·타임라인 선택 시 동일 시점 이동
- 본인 북마크만 조회·삭제
- 초기 범위에는 메모·색상·분류 없음

## 10. 퀴즈

### 10.1 `QUIZ-01` 현재 게시 퀴즈

```http
GET /api/v1/lessons/{lessonId}/quizzes
```

```json
{
  "quizId": "qiz_01J...",
  "version": 3,
  "title": "Spring Security 확인 퀴즈",
  "attemptPolicy": {
    "maxAttempts": null,
    "showCorrectAnswer": true,
    "showExplanation": true
  },
  "questions": [
    {
      "questionId": "qq_01J...",
      "type": "SINGLE_CHOICE",
      "prompt": "SecurityFilterChain의 역할은?",
      "options": [
        {"optionId": "opt_1", "text": "HTTP 보안 필터 체인을 정의한다."},
        {"optionId": "opt_2", "text": "DB schema를 생성한다."}
      ],
      "sessionMs": 118000
    }
  ],
  "latestAttempt": null,
  "newVersionAvailable": false
}
```

응시 전 응답에는 정답을 포함하지 않는다.

### 10.2 `QUIZ-02` 응시 제출

```http
POST /api/v1/quizzes/{quizId}/attempts
```

```json
{
  "quizVersion": 3,
  "answers": [
    {
      "questionId": "qq_01J...",
      "selectedOptionIds": ["opt_1"]
    }
  ]
}
```

```json
{
  "attemptId": "qat_01J...",
  "quizId": "qiz_01J...",
  "quizVersion": 3,
  "score": 100,
  "correctCount": 1,
  "totalCount": 1,
  "results": [
    {
      "questionId": "qq_01J...",
      "correct": true,
      "correctOptionIds": ["opt_1"],
      "explanation": "SecurityFilterChain은 HTTP 보안 필터 구성을 정의합니다.",
      "sessionMs": 118000
    }
  ],
  "submittedAt": "2026-08-02T10:20:00+09:00"
}
```

- 서버가 게시 version과 제출 version을 검증
- 채점은 서버의 게시된 정답으로 결정론 수행
- 재응시 횟수·정답·해설 공개 정책에 따라 결과 필드 제어
- 새 version 게시 후 기존 attempt를 삭제·재채점하지 않음
- version 충돌은 `409 QUIZ_VERSION_CHANGED`와 최신 version 제공

## 11. replay 공개·회수

### 11.1 게시

```http
POST /api/v1/instructor/lessons/{lessonId}/replay/publish
```

서버는 video asset `READY`, lesson 소유권, 게시 차단 상태를 검증한다. AI 콘텐츠가 미게시여도 영상 게시를 허용한다.

```json
{
  "lessonId": "les_01J...",
  "videoAssetStatus": "READY",
  "replayStatus": "PUBLISHED",
  "publishedAt": "2026-08-02T11:00:00+09:00"
}
```

### 11.2 회수

```http
POST /api/v1/instructor/lessons/{lessonId}/replay/withdraw
```

```json
{
  "reason": "검수 필요"
}
```

신규 수강생 재생 URL 발급을 중단한다. 이미 발급된 URL을 즉시 무효화할지 TTL까지 허용할지는 media gate 정책과 협의한다.

## 12. 강사 콘텐츠 검수·게시

### 12.1 content type과 상태

`contentType`: `TRANSCRIPT`, `GLOSSARY`, `CHAPTERS`, `QUIZ`

영역별 상태 제안: `NOT_READY`, `PROCESSING`, `READY_FOR_REVIEW`, `DRAFT_SAVED`, `PUBLISHED`, `FAILED`

### 12.2 `REVIEW-01` 검수 조회

```http
GET /api/v1/instructor/lessons/{lessonId}/reviews?contentType=TRANSCRIPT
```

```json
{
  "contentType": "TRANSCRIPT",
  "status": "READY_FOR_REVIEW",
  "sourceVersion": 4,
  "candidate": {
    "generatedAt": "2026-08-02T10:00:00+09:00",
    "content": {}
  },
  "draft": {
    "draftVersion": 2,
    "basePublishedVersion": 1,
    "content": {},
    "updatedAt": "2026-08-02T10:30:00+09:00"
  },
  "published": {
    "version": 1,
    "content": {},
    "publishedAt": "2026-08-01T12:00:00+09:00"
  },
  "allowedActions": ["SAVE_REVIEW_DRAFT", "PUBLISH_CONTENT"]
}
```

실제 `content` schema는 content type별 게시 조회 DTO와 같은 구조를 재사용한다. AI 내부 prompt·model credential·raw trace는 노출하지 않는다.

### 12.3 `REVIEW-02` 초안 저장

```http
PUT /api/v1/instructor/lessons/{lessonId}/reviews/{contentType}/draft
```

```json
{
  "baseDraftVersion": 2,
  "basePublishedVersion": 1,
  "content": {}
}
```

- 성공 시 새 `draftVersion` 반환
- 동시 편집 충돌은 `409 REVIEW_DRAFT_VERSION_CONFLICT`
- 기존 게시본은 변경하지 않음
- 게시본이 바뀐 뒤 오래된 base로 저장하면 명시적 충돌 처리

### 12.4 `REVIEW-03` 게시

```http
POST /api/v1/instructor/lessons/{lessonId}/reviews/{contentType}/publish
```

```json
{
  "draftVersion": 3,
  "basePublishedVersion": 1
}
```

```json
{
  "contentType": "TRANSCRIPT",
  "publishedVersion": 2,
  "publishedAt": "2026-08-02T11:00:00+09:00",
  "active": true
}
```

- 새 core 게시본 version 생성 후 활성 version을 원자적으로 교체
- 게시 실패 시 기존 활성 게시본 유지
- AI 원본·후보를 덮어쓰지 않음
- 진행 중 AI 답변·퀴즈 응시는 시작 당시 version으로 완료
- 퀴즈 새 version 게시 후 기존 응시 기록 유지

게시본 되돌리기는 초기 범위에서 제외한다.

## 13. 강사용 익명 질문·학습 통계

### 13.1 질문 핀

```http
GET /api/v1/instructor/lessons/{lessonId}/question-pins?bucketMs=30000
```

집계 출처:

- 질문으로 등록된 라이브 채팅
- 라이브 개인 AI Q&A
- VOD 개인 AI Q&A

응답은 전체 개수, 구간별 핀, source별 개수를 제공한다. 핀 원문 조회는 질문 text·source·`sessionMs`만 반환하고 userId·실명·가명·개인 AI 답변은 제외한다.

### 13.2 학습 요약

```http
GET /api/v1/instructor/lessons/{lessonId}/learning-summary
```

```json
{
  "enrolleeCount": 30,
  "playback": {
    "startedCount": 24,
    "completedCount": 18,
    "completionRate": 60
  },
  "quiz": {
    "publishedVersion": 3,
    "attemptedCount": 20,
    "completedCount": 20,
    "averageScore": 82.5
  },
  "questionCount": 18,
  "updatedAt": "2026-08-02T11:00:00+09:00"
}
```

초기에는 집계만 제공한다. 개인별 진행·질문·응시 상세는 포함하지 않는다.

## 14. 상태·부분 실패 원칙

| 상태 조합 | 수강생 처리 |
|---|---|
| 자산 `FINALIZING/VERIFYING` | 레슨 상세에서 준비 중 |
| 자산 `READY` + replay `READY_FOR_REVIEW` | 게시 대기, 재생 불가 |
| 자산 `READY` + replay `PUBLISHED` + AI 미게시 | 영상 재생, AI 영역 숨김 또는 준비 상태 |
| 일부 AI 게시 | 게시된 영역만 활성화 |
| 일부 AI 실패 | 영상과 기존 게시 영역 유지 |
| replay `WITHDRAWN` | 공개 중단, 신규 재생 불가 |

- transcript·glossary·chapters·quiz 실패를 하나의 전역 AI 실패로 합치지 않는다.
- 재생 URL 만료는 URL 재발급으로 복구하고 HLS 자체 오류와 구분한다.
- 진도 저장·AI·퀴즈 오류가 영상 재생을 중단하지 않는다.
- 인증·수강 권한이 회수되면 재생 URL·SSE·학습 요청을 중단한다.

## 15. 백엔드 협의 사항

1. HLS URL TTL·재발급·replay 회수 시 즉시 무효화 정책
2. 진행률 유효 시청 range·중복 재생·90% 완료 계산 방식
3. out-of-order 진도 저장 충돌 처리
4. 자막 전체 조회·시간 범위·검색 페이지네이션 방식
5. 게시본이 없는 영역의 `200` 빈 응답 또는 `204` 규칙
6. AI Q&A SSE event와 content version 고정 방식
7. 퀴즈 재응시 횟수·정답·해설 공개 범위
8. 검수 초안 낙관적 동시성·자동 저장·충돌 UX
9. content type별 후보·초안·게시 DTO의 최대 크기와 분할 API 필요 여부
10. replay 회수와 AI 게시본 독립성
11. 질문 핀 bucket과 익명화 기준
12. 학습 통계 갱신 주기와 최소 집계 인원 기준

