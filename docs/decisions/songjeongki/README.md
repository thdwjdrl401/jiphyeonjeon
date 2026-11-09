# 송정기 ADR

작성자 송정기의 기술 결정 기록. 결정 하나에 문서 하나다. 주제별로 먼저 묶고, 아래에 전체 목록을 번호순으로 둔다.

## 알림 팬아웃·웹 푸시 발송 (집현전 확장, 100만 명 발송)

- [0073](0073-notification-fanout-architecture.md) 알림 팬아웃은 사건 트리거와 커서 범위 메시지로 구성한다
- [0122](0122-the-commit-wakes-the-relay.md) 아웃박스 릴레이는 커밋 후 깨우고 폴링은 30초 안전망으로 둔다
- [0123](0123-notification-partition-and-content.md) 알림 본체는 월 파티션으로 나누고 문구는 사건당 한 번만 저장한다
- [0124](0124-push-delivery-queue-and-progress.md) 푸시 발송은 전용 큐로 분리하고 진행 표에 발송 시도 완료 대상을 기록한다
- [0127](0127-push-worker-node-role-split.md) 발송 워커를 별도 노드로 분리하고 늘어나는 노드의 주기 작업을 끈다
- [0128](0128-a-throttled-push-is-not-a-delivered-push.md) 429·5xx로 막힌 푸시는 발송 완료로 기록하지 않는다
- [0129](0129-the-foreign-key-costs-a-fifth-of-the-fanout.md) 알림 문구 외래 키를 제거한다
- [0130](0130-a-wide-fanout-goes-out-in-lanes.md) 넓은 팬아웃은 uuid 구간별 명령으로 나눠 발행한다
- [0131](0131-the-next-slice-goes-out-before-the-app-work.md) 팬아웃 워커는 다음 조각을 푸시 명령 조립보다 먼저 발행한다
- [0132](0132-notifications-are-not-deleted-so-the-table-is-not-partitioned.md) 알림 테이블의 월 파티셔닝을 제거한다
- [0133](0133-the-listener-retries-only-what-can-succeed.md) 알림 리스너는 재시도 가능한 예외만 재시도하고 DLQ 깊이 경보를 둔다
- [0134](0134-the-chain-count-follows-the-database-core-count.md) 체인 수는 Postgres 물리 코어 수에 맞춘다
- [0135](0135-the-fanout-elapsed-comes-from-the-row-timestamps.md) 팬아웃 소요는 알림 행의 created_at으로 측정한다
- [0136](0136-the-push-consumer-holds-one-message-at-a-time.md) 푸시 리스너의 prefetch를 1로 둔다
- [0137](0137-the-progress-check-runs-only-on-redelivery.md) 진행 조회는 재배달에만 실행하고 동시 상한은 공급자 반응으로 조절한다
- [0138](0138-push-nodes-scale-by-machine-not-by-splitting-cores.md) 발송 노드는 기계 단위로 늘린다
- [0076](0076-enrollment-notification-action-axis-settlement.md) 수강 신청 알림의 처리 축을 닫는다, 사건에서 닫고, 열람에서 복구한다
- [0085](0085-notification-target-gates-by-type.md) 알림 재판정의 게이트를 종류에 맞춘다, 받는 사람과 취소의 의미
- [0108](0108-notification-dropdown-shows-everything.md) 알림 드롭다운은 최근 몇 건이 아니라 전부를 보여 준다

## 실시간 자막 파이프라인

- [0008](0008-ai-bus-redis-streams-session-clock.md) AI 버스 = Redis Streams, 자막 싱크 = 세션 상대 ms
- [0013](0013-unified-streaming-stt.md) 통합 스트리밍 STT (VAD, VOD·라이브 공유)
- [0040](0040-caption-delta-contract.md) 라이브 자막 계약, 델타 스트림 채택 + 보강 3건 (제안)
- [0043](0043-caption-consumer-persistence.md) 라이브 자막 소비 파이프라인, Spring consumer·영속·WS 전달
- [0044](0044-fe-caption-delta-rendering.md) FE 라이브 자막 렌더, 델타 누적 라인 + CaptionView 매핑
- [0045](0045-live-caption-position-sync-approx-session-ms.md) 라이브 자막 위치 동기화, 근사 세션-ms(occurredAt 기반)
- [0052](0052-caption-segment-anchor-consumption.md) 자막 발화 경계·시간 앵커 소비, Spring 영속(1차 슬라이스)
- [0053](0053-caption-segment-delivery-and-render.md) 자막 세그먼트 전달·렌더, segment.final WS/REST + FE 권위 렌더
- [0102](0102-instructor-reads-captions-live.md) 강사는 자막을 실시간으로, 접어 둔 채로 본다
- [0104](0104-anchored-caption-session-ms.md) 자막 세션-ms를 앵커로 정밀화하고, 근사값을 지우지 않는다
- [0106](0106-caption-time-axis-is-wall-clock-not-audio.md) 자막 시각축은 벽시계여야 한다, 오디오 누적으로는 안 된다
- [0107](0107-caption-segments-carry-wall-clock.md) 자막 세그먼트가 벽시계를 싣는다

## 미디어·라이브 (LiveKit self-host, 녹화)

- [0004](0004-media-livekit-selfhost.md) 미디어 서버 = LiveKit self-host (Kurento 대체)
- [0010](0010-self-host-vod.md) VOD = LiveKit Egress 녹화 (업로드·FFmpeg 없음)
- [0020](0020-egress-recording-lifecycle.md) 라이브 녹화 생명주기 = 세션 이벤트 기반 best-effort Egress 제어
- [0032](0032-media-playback-hls-only.md) 학생 재생은 HLS 단일, LiveKit은 인제스트·Egress·STT로 유지 (WebRTC 직접 재생 폐기)
- [0034](0034-egress-completion-webhook.md) Egress 완료 webhook, 녹화 자산 확정(READY/FAILED)과 서명 검증
- [0048](0048-egress-composite-audio-contract.md) Egress 합성 오디오 계약, 합성 페이지가 소리를 내야 한다
- [0060](0060-live-presence-counts-subscriptions.md) 접속자 수는 LiveKit 참여자가 아니라 세션 토픽 구독을 센다
- [0078](0078-livekit-ports-off-the-blocked-range.md) LiveKit을 막힌 포트 대역 밖으로 옮긴다, 미디어 3478/udp, 시그널링 443
- [0084](0084-live-classroom-waits-in-place.md) 대기실을 만들지 않고 강의실 안에서 기다린다, 시작 신호를 상태 토픽에 싣는다
- [0088](0088-orphan-egress-purge-through-a-narrow-relay.md) 유령 Egress는 좁은 중계로 걷어낸다, Redis를 브리지에 열지 않는다
- [0119](0119-a-lecture-nobody-is-in-must-end-itself.md) 아무도 없는 라이브는 스스로 끝난다

## 기반 구조·배포

- [0003](0003-greenfield-redesign.md) 명세·스켈레톤 참고용, 제로베이스 재설계
- [0005](0005-db-postgres-pgvector.md) DB = PostgreSQL + pgvector (MySQL 대체)
- [0006](0006-backend-spring-plus-python-ai.md) 컨트롤 플레인 = Spring Boot(Java), AI 플레인 = Python 분리
- [0009](0009-java21-spring-boot-3.md) 백엔드 = Java 21 + Spring Boot 4.1
- [0011](0011-ai-three-services.md) AI 플레인 = 3-서비스 (ai-api + ai-worker + realtime-agent)
- [0012](0012-hybrid-queue.md) 하이브리드 큐, RabbitMQ(배치) + Redis Streams(fast path)
- [0014](0014-auth-redis-session-cookie.md) 인증 = HttpOnly 쿠키 + Redis 세션 (엣지), 내부 S2S·미디어 = JWT
- [0015](0015-docker-deploy-fe-be-nginx.md) EC2 배포, 전부 Docker + nginx(SSL 종단·`/api` 프록시) + Let's Encrypt
- [0022](0022-local-vs-ec2-infra-profile.md) 로컬↔EC2 인프라 전환 = Spring 프로필(remote) + EC2 포트 공개(expose)
- [0038](0038-ci-test-gate-testcontainers.md) CI 테스트 게이트, Testcontainers 도입 + MR 파이프라인에 백엔드·프론트 테스트 추가
- [0082](0082-ci-tests-off-the-burstable-instance.md) CI 테스트를 운영 EC2에서 전부 뺀다, t2.xlarge의 지속 CPU는 0.9 vCPU다
- [0086](0086-resource-ceilings-we-choose.md) 자원 상한을 우리가 정한다, nginx·Hikari·Redis·consumer 이름
- [0126](0126-single-host-deployment-behind-host-nginx.md) 배포 호스트의 nginx가 단일 엔트리다

## 전체 목록 (135개)

| 번호 | 결정 |
|---|---|
| [0001](0001-field-name-camelcase.md) | API 필드명을 camelCase로 통일 |
| [0002](0002-react-typescript-frontend.md) | 프론트엔드를 React + TypeScript로 전환 |
| [0003](0003-greenfield-redesign.md) | 명세·스켈레톤 참고용, 제로베이스 재설계 |
| [0004](0004-media-livekit-selfhost.md) | 미디어 서버 = LiveKit self-host (Kurento 대체) |
| [0005](0005-db-postgres-pgvector.md) | DB = PostgreSQL + pgvector (MySQL 대체) |
| [0006](0006-backend-spring-plus-python-ai.md) | 컨트롤 플레인 = Spring Boot(Java), AI 플레인 = Python 분리 |
| [0007](0007-domain-live-session.md) | 도메인 = live_session 중심 재정의 |
| [0008](0008-ai-bus-redis-streams-session-clock.md) | AI 버스 = Redis Streams, 자막 싱크 = 세션 상대 ms |
| [0009](0009-java21-spring-boot-3.md) | 백엔드 = Java 21 + Spring Boot 4.1 |
| [0010](0010-self-host-vod.md) | VOD = LiveKit Egress 녹화 (업로드·FFmpeg 없음) |
| [0011](0011-ai-three-services.md) | AI 플레인 = 3-서비스 (ai-api + ai-worker + realtime-agent) |
| [0012](0012-hybrid-queue.md) | 하이브리드 큐, RabbitMQ(배치) + Redis Streams(fast path) |
| [0013](0013-unified-streaming-stt.md) | 통합 스트리밍 STT (VAD, VOD·라이브 공유) |
| [0014](0014-auth-redis-session-cookie.md) | 인증 = HttpOnly 쿠키 + Redis 세션 (엣지), 내부 S2S·미디어 = JWT |
| [0015](0015-docker-deploy-fe-be-nginx.md) | EC2 배포, 전부 Docker + nginx(SSL 종단·`/api` 프록시) + Let's Encrypt |
| [0016](0016-drop-api-path-versioning.md) | API 경로 버저닝 제거 (`/api/v1` → `/api`) |
| [0017](0017-schema-ownership-core-ai.md) | core / ai 스키마 소유권 경계 (write-owner 기준) |
| [0018](0018-pk-strategy-uuid-bigint-hybrid.md) | PK 전략, uuid(v4) 도메인 / bigint identity 고빈도 하이브리드 |
| [0019](0019-ws-realtime-chat-stomp.md) | 실시간 채팅 = STOMP over WebSocket + 커밋 후 이벤트 브로드캐스트 |
| [0020](0020-egress-recording-lifecycle.md) | 라이브 녹화 생명주기 = 세션 이벤트 기반 best-effort Egress 제어 |
| [0021](0021-lesson-publish-mvp-direct.md) | 레슨 발행 = MVP 직행 DRAFT→PUBLISHED (AI 준비도 게이팅 없음) |
| [0022](0022-local-vs-ec2-infra-profile.md) | 로컬↔EC2 인프라 전환 = Spring 프로필(remote) + EC2 포트 공개(expose) |
| [0023](0023-asset-presigned-upload.md) | 파일 업로드 = presigned 직접 업로드 + 범용 asset |
| [0024](0024-orphan-module-scaffolding.md) | aiintegration·learning 패키지는 배선 없는 스키마 골격으로 유지 |
| [0025](0025-structure-reorder-and-version-cas.md) | 구조 순서 원자 저장(STRUCTURE-01)과 structure_version compare-and-set |
| [0026](0026-catalog-viewer-context.md) | 카탈로그 응답에 viewerContext를 담고, 내 수강 목록 조립을 curriculum 모듈이 맡는다 |
| [0027](0027-frontend-incremental-api-cutover.md) | 프론트 mock→실 API 전환은 서비스 단위 점진 교체로 한다 (기능별 플래그 없이) |
| [0028](0028-instructor-curriculum-list.md) | 강사 운영 목록(MY-CURRICULUM-02), 페이지 봉투·파생 파인더·`nextLiveSession` 의미와 미구현 필드 처리 |
| [0029](0029-lesson-detail-and-display-name.md) | FE가 이미 부르고 있던 두 경로 구현, 수강생 레슨 상세·표시 이름 변경, 그리고 목차 `status` 재고정 |
| [0030](0030-frontend-unimplemented-api-and-partial-writes.md) | 프론트가 없는 서버 경로를 다루는 방식, 명시적 501·부분 쓰기 차단·부가 조회 분리 |
| [0031](0031-account-profile-security.md) | 계정·프로필·보안 API, 강사 공개 프로필·비밀번호 변경·소프트 탈퇴 |
| [0032](0032-media-playback-hls-only.md) | 학생 재생은 HLS 단일, LiveKit은 인제스트·Egress·STT로 유지 (WebRTC 직접 재생 폐기) |
| [0033](0033-learning-progress-wiring.md) | 학습 상태 배선, 진도·북마크, 클라이언트 계산 진도율, SPI 인가, 카탈로그 progress 연결 |
| [0034](0034-egress-completion-webhook.md) | Egress 완료 webhook, 녹화 자산 확정(READY/FAILED)과 서명 검증 |
| [0035](0035-lesson-material-attach.md) | 자료→레슨 연결, presigned 티켓 방식, MATERIAL 발급 허용, 레슨 단위 연결 |
| [0036](0036-material-embedding-pipeline.md) | 강의 자료 임베딩 파이프라인, outbox→RabbitMQ→AI→pgvector→콜백(inbox) |
| [0037](0037-enrollment-roster-paging-and-q-deferral.md) | 강사 수강생 로스터(ENROLLEE-01), 단일 페이지 엔드포인트·summary 집계·`q` 검색 보류 |
| [0038](0038-ci-test-gate-testcontainers.md) | CI 테스트 게이트, Testcontainers 도입 + MR 파이프라인에 백엔드·프론트 테스트 추가 |
| [0039](0039-replay-playback-api.md) | 다시보기 재생 API, presigned manifest 인라인, PDT 앵커 온디맨드 계산, 게시 최소형 |
| [0040](0040-caption-delta-contract.md) | 라이브 자막 계약, 델타 스트림 채택 + 보강 3건 (제안) |
| [0041](0041-instructor-authoring-reads-and-autosave.md) | 강사 저작 읽기는 강사 권한 축으로 · 구조 편집은 자동 저장 · 강사 대시보드 요약 |
| [0042](0042-curriculum-material-attach-and-embedding-scope.md) | 커리큘럼-레벨 자료 연결, material_asset 스코프 확장, 임베딩 잡 scope 구분 |
| [0043](0043-caption-consumer-persistence.md) | 라이브 자막 소비 파이프라인, Spring consumer·영속·WS 전달 |
| [0044](0044-fe-caption-delta-rendering.md) | FE 라이브 자막 렌더, 델타 누적 라인 + CaptionView 매핑 |
| [0045](0045-live-caption-position-sync-approx-session-ms.md) | 라이브 자막 위치 동기화, 근사 세션-ms(occurredAt 기반) |
| [0046](0046-instructor-stage-canvas-and-camera-mirror.md) | 강사 라이브 화면, 합성 캔버스 미리보기와 "카메라만" 좌우 반전 |
| [0047](0047-live-ai-answer-sse-proxy.md) | 라이브 AI 질의응답, 브라우저 SSE 프록시와 ai-api HMAC signer |
| [0048](0048-egress-composite-audio-contract.md) | Egress 합성 오디오 계약, 합성 페이지가 소리를 내야 한다 |
| [0049](0049-fe-ai-chat-conversation-ux.md) | FE 개인 AI 질의응답, 단발 폼에서 대화형(챗) UX로, 이력은 클라이언트 메모리만 |
| [0050](0050-chat-anonymity-is-sender-choice.md) | 라이브 채팅 익명은 기본값이 아니라 발신자 선택 |
| [0051](0051-instructor-annotation-excalidraw.md) | 강사 판서는 Excalidraw 문서로 두고, Egress는 `exportToCanvas`로 읽기 전용 렌더한다 |
| [0052](0052-caption-segment-anchor-consumption.md) | 자막 발화 경계·시간 앵커 소비, Spring 영속(1차 슬라이스) |
| [0053](0053-caption-segment-delivery-and-render.md) | 자막 세그먼트 전달·렌더, segment.final WS/REST + FE 권위 렌더 |
| [0054](0054-annotation-ai-semantics-not-coordinates.md) | 판서 AI는 **의미만** 모델에게 묻고 좌표는 우리가 계산한다 |
| [0055](0055-annotation-full-state-is-pulled.md) | 판서 전체 상태는 **받아가고**, 실시간 채널에는 델타만 흘린다 |
| [0056](0056-annotation-view-state-derives-from-server.md) | 강사 화면의 판서 상태는 **서버 문서에서 파생**한다 |
| [0057](0057-annotation-restore-needs-a-checkpoint.md) | 판서 복원은 **체크포인트**를 둔다, op 테이블 밖에 |
| [0058](0058-annotation-interpret-image-by-url.md) | 판서 해석 이미지는 **본문에 싣지 않고 URL로** 준다 |
| [0059](0059-live-processing-status-is-two-axes.md) | 종료 후 처리 현황은 두 상태축을 접지 않고 그대로 준다 |
| [0060](0060-live-presence-counts-subscriptions.md) | 접속자 수는 LiveKit 참여자가 아니라 세션 토픽 구독을 센다 |
| [0061](0061-lecture-note-read-model-is-producer-agnostic.md) | 강의 노트는 "현재 전체" 한 벌로 저장하고, 화면에도 늘 전체를 준다 |
| [0062](0062-live-ai-answer-history.md) | AI 질의응답을 남긴다, 스트림 끝에서 한 번, 개인 범위로 |
| [0063](0063-watch-heatmap-buckets.md) | 시청 기록은 고정 길이 칸으로 세고, 그래프는 도달자로 나눈다 |
| [0064](0064-lesson-glossary-two-layers.md) | 용어집은 AI 원본 위에 강사 수정본을 덮고, 자막 매핑은 화면이 한다 |
| [0065](0065-live-replay-screen-alignment.md) | 라이브·다시보기는 한 벌의 화면이고, 크기는 사용자가 정한다 |
| [0066](0066-draft-curriculum-detail-is-visible-to-its-owner.md) | 공개 전 커리큘럼 상세는 만든 강사에게 열린다, 남에게는 그대로 404 |
| [0067](0067-denormalized-fk-cascades-with-its-parent.md) | 비정규화 FK는 부모와 함께 지운다, 삭제를 막는 쪽이 아니라 |
| [0068](0068-guest-redirect-has-one-owner.md) | 로그인하지 않은 사람을 어디로 보낼지는 한 곳이 정한다 |
| [0069](0069-number-collisions-close-the-merge-window.md) | 번호 충돌은 검사로 못 막는다, rebase를 강제해 머지 창을 닫는다 |
| [0070](0070-lecture-note-renders-server-markdown.md) | 강의 노트는 서버가 준 Markdown을 그대로 그린다 |
| [0071](0071-sidebar-tabs-hide-instead-of-unmount.md) | 학습 사이드바 탭은 패널을 지우지 않고 감춘다 |
| [0072](0072-published-curriculum-keeps-its-structure.md) | 게시된 커리큘럼은 구조를 유지하고, 커리큘럼 자료는 커리큘럼 것만이다 |
| [0073](0073-notification-fanout-architecture.md) | 알림 팬아웃은 사건 트리거와 커서 범위 메시지로 구성한다 |
| [0074](0074-annotation-highlight-evidence-contract.md) | 강조 판서를 영실이 근거로 쓴다, 이미지는 우리가 읽고, AI는 텍스트를 색인한다 |
| [0075](0075-replay-ai-answer-sse-proxy.md) | 다시보기 AI 질의응답, Spring 중계 개통(ADR-0047 §9 해소) |
| [0076](0076-enrollment-notification-action-axis-settlement.md) | 수강 신청 알림의 처리 축을 닫는다, 사건에서 닫고, 열람에서 복구한다 |
| [0077](0077-replay-timeline-reveal-for-captions-and-chat.md) | 다시보기의 자막·채팅은 재생 위치까지만 드러낸다, 노트는 예외로 둔다 |
| [0078](0078-livekit-ports-off-the-blocked-range.md) | LiveKit을 막힌 포트 대역 밖으로 옮긴다, 미디어 3478/udp, 시그널링 443 |
| [0079](0079-annotation-highlight-sends-the-whole-frame.md) | 강조 근거는 자르지 않는다, 화면 전체를 보내고 강조는 색으로 알린다 |
| [0080](0080-annotation-render-splits-the-active-stroke.md) | 판서 렌더는 긋는 중인 획 한 장을 따로 얹는다 |
| [0081](0081-live-ai-question-carries-the-asker.md) | 라이브 AI 질문에 질문자를 실어 대화를 잇고, 자막 근거는 화면에서 감춘다 |
| [0082](0082-ci-tests-off-the-burstable-instance.md) | CI 테스트를 운영 EC2에서 전부 뺀다, t2.xlarge의 지속 CPU는 0.9 vCPU다 |
| [0083](0083-learning-progress-has-no-writer.md) | 학생 진행률이 늘 0%였던 이유, 진도를 보내는 쪽이 없었다 |
| [0084](0084-live-classroom-waits-in-place.md) | 대기실을 만들지 않고 강의실 안에서 기다린다, 시작 신호를 상태 토픽에 싣는다 |
| [0085](0085-notification-target-gates-by-type.md) | 알림 재판정의 게이트를 종류에 맞춘다, 받는 사람과 취소의 의미 |
| [0086](0086-resource-ceilings-we-choose.md) | 자원 상한을 우리가 정한다, nginx·Hikari·Redis·consumer 이름 |
| [0087](0087-manage-toolbar-enrollee-count-and-notice-tones.md) | 관리 요약의 수강생 수, 그리고 "알림이 알림처럼 보이지 않는" 세 가지 |
| [0088](0088-orphan-egress-purge-through-a-narrow-relay.md) | 유령 Egress는 좁은 중계로 걷어낸다, Redis를 브리지에 열지 않는다 |
| [0089](0089-admin-console-reads-names-not-uuids.md) | 운영 콘솔은 이름을 읽는다, 조합 전용 모듈과, 링크를 공개 화면에만 거는 이유 |
| [0090](0090-vod-has-no-review-step.md) | 영상에는 검수 단계를 두지 않는다, 말과 코드를 맞춘다 |
| [0094](0094-lesson-detail-tells-the-truth-about-recording.md) | 강의 상세의 녹화 배지가 진짜 상태를 말한다, ADR-0092의 전제를 채운다 |
| [0095](0095-api-docs-ship-as-a-static-page.md) | API 문서는 Swagger UI가 아니라 정적 페이지로 내보낸다 |
| [0096](0096-ai-answers-render-as-markdown.md) | AI 답변을 Markdown으로 그린다, 스트리밍 중에도, 링크는 빼고 |
| [0097](0097-code-blocks-highlight-only-what-they-declare.md) | 코드 블록은 밝힌 언어만 칠한다, 그리고 하이라이터를 직접 붙인 이유 |
| [0098](0098-device-failure-is-not-connection-failure.md) | 장치 실패는 연결 실패가 아니다 |
| [0099](0099-microphone-is-shown-not-required.md) | 마이크는 표시하되 막지 않는다 |
| [0100](0100-demo-publishes-a-file-not-a-camera.md) | 시연은 카메라 대신 파일을 올린다, 그 아래로는 아무것도 바꾸지 않는다 |
| [0101](0101-live-controls-say-what-they-cost.md) | 라이브 컨트롤은 대가가 큰 것만 말한다 |
| [0102](0102-instructor-reads-captions-live.md) | 강사는 자막을 실시간으로, 접어 둔 채로 본다 |
| [0103](0103-demo-swaps-the-microphone-mid-lecture.md) | 시연은 강의 도중 마이크만 파일로 갈아끼운다 |
| [0104](0104-anchored-caption-session-ms.md) | 자막 세션-ms를 앵커로 정밀화하고, 근사값을 지우지 않는다 |
| [0105](0105-anonymous-chat-carries-no-face.md) | 익명 채팅은 얼굴을 싣지 않는다 |
| [0106](0106-caption-time-axis-is-wall-clock-not-audio.md) | 자막 시각축은 벽시계여야 한다, 오디오 누적으로는 안 된다 |
| [0107](0107-caption-segments-carry-wall-clock.md) | 자막 세그먼트가 벽시계를 싣는다 |
| [0108](0108-notification-dropdown-shows-everything.md) | 알림 드롭다운은 최근 몇 건이 아니라 전부를 보여 준다 |
| [0109](0109-recorded-upload-survives-failure.md) | 녹화강의 업로드는 실패를 견딘다 |
| [0110](0110-live-glossary-is-pushed-not-polled.md) | 라이브 용어집은 밀어 준다 |
| [0111](0111-glossary-delete-is-a-tombstone.md) | 용어 삭제는 원본을 지우지 않고 묘비 행을 남긴다 |
| [0112](0112-material-search-respects-the-scope-it-was-attached-to.md) | 자료 검색은 자료가 붙은 자리를 지킨다 |
| [0113](0113-post-end-chat-has-nowhere-to-land.md) | 종료 뒤 채팅은 갈 곳이 없다, ENDED부터 채팅만 닫는다 |
| [0114](0114-curriculum-material-uses-the-same-v2-job-as-a-lesson.md) | 커리큘럼 자료도 레슨과 같은 v2 잡을 쓴다 |
| [0115](0115-glossary-collects-curriculum-materials-too.md) | 용어집도 커리큘럼 자료를 모은다 |
| [0116](0116-progress-never-goes-backwards.md) | 진도는 뒤로 가지 않는다 |
| [0117](0117-progress-settles-when-the-recording-is-ready.md) | 진도는 녹화가 준비될 때 정산된다 |
| [0118](0118-password-reset-sends-a-temporary-password.md) | 비밀번호 찾기는 임시 비밀번호를 보내고, 첫 로그인에서 바꾸게 한다 |
| [0119](0119-a-lecture-nobody-is-in-must-end-itself.md) | 아무도 없는 라이브는 스스로 끝난다 |
| [0120](0120-recorded-upload-locks-before-the-form-not-after.md) | 녹화강의 업로드는 폼 뒤가 아니라 폼 앞에서 잠근다 |
| [0121](0121-the-console-sees-people-not-just-machines.md) | 운영 콘솔이 기계 말고 사람을 본다, 접속자는 STOMP로, 시청은 시청 보고로 |
| [0122](0122-the-commit-wakes-the-relay.md) | 아웃박스 릴레이는 커밋 후 깨우고 폴링은 30초 안전망으로 둔다 |
| [0123](0123-notification-partition-and-content.md) | 알림 본체는 월 파티션으로 나누고 문구는 사건당 한 번만 저장한다 |
| [0124](0124-push-delivery-queue-and-progress.md) | 푸시 발송은 전용 큐로 분리하고 진행 표에 발송 시도 완료 대상을 기록한다 |
| [0125](0125-bge-runtime-accepts-cpu-device.md) | BGE-M3 런타임은 CPU device를 받아들인다 |
| [0126](0126-single-host-deployment-behind-host-nginx.md) | 배포 호스트의 nginx가 단일 엔트리다 |
| [0127](0127-push-worker-node-role-split.md) | 발송 워커를 별도 노드로 분리하고 늘어나는 노드의 주기 작업을 끈다 |
| [0128](0128-a-throttled-push-is-not-a-delivered-push.md) | 429·5xx로 막힌 푸시는 발송 완료로 기록하지 않는다 |
| [0129](0129-the-foreign-key-costs-a-fifth-of-the-fanout.md) | 알림 문구 외래 키를 제거한다 |
| [0130](0130-a-wide-fanout-goes-out-in-lanes.md) | 넓은 팬아웃은 uuid 구간별 명령으로 나눠 발행한다 |
| [0131](0131-the-next-slice-goes-out-before-the-app-work.md) | 팬아웃 워커는 다음 조각을 푸시 명령 조립보다 먼저 발행한다 |
| [0132](0132-notifications-are-not-deleted-so-the-table-is-not-partitioned.md) | 알림 테이블의 월 파티셔닝을 제거한다 |
| [0133](0133-the-listener-retries-only-what-can-succeed.md) | 알림 리스너는 재시도 가능한 예외만 재시도하고 DLQ 깊이 경보를 둔다 |
| [0134](0134-the-chain-count-follows-the-database-core-count.md) | 체인 수는 Postgres 물리 코어 수에 맞춘다 |
| [0135](0135-the-fanout-elapsed-comes-from-the-row-timestamps.md) | 팬아웃 소요는 알림 행의 created_at으로 측정한다 |
| [0136](0136-the-push-consumer-holds-one-message-at-a-time.md) | 푸시 리스너의 prefetch를 1로 둔다 |
| [0137](0137-the-progress-check-runs-only-on-redelivery.md) | 진행 조회는 재배달에만 실행하고 동시 상한은 공급자 반응으로 조절한다 |
| [0138](0138-push-nodes-scale-by-machine-not-by-splitting-cores.md) | 발송 노드는 기계 단위로 늘린다 |
