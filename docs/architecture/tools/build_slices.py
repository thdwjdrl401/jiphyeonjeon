# -*- coding: utf-8 -*-
from gen_drawio import *

X = [40, 280, 520, 760, 1000]
Y = [60, 170, 280, 390, 500, 610]
D = []

# ---------- 00 전체 지도 ----------
D.append(("00 · 기능 슬라이스 지도", [
    Z("z1", "학생이 쓰는 것", X[0]-20, Y[0]-30, 460, 350),
    N("s1", "인증·세션", "로그인 · 쿠키 · Redis", X[0], Y[0], 180, 56, KEY),
    N("s2", "커리큘럼 탐색", "카탈로그 · 상세", X[1], Y[0], 180, 56, KEY),
    N("s3", "수강 신청", "즉시 · 승인형", X[0], Y[1], 180, 56, KEY),
    N("s4", "라이브 시청", "토큰 · WebRTC", X[1], Y[1], 180, 56, KEY),
    N("s5", "실시간 채팅", "STOMP", X[0], Y[2], 180, 56, KEY),
    N("s6", "다시보기", "재생 API 미착수", X[1], Y[2], 180, 56, PLAN),

    Z("z2", "강사가 쓰는 것", X[2]-20, Y[0]-30, 460, 350),
    N("s7", "커리큘럼 관리", "생성 · 발행 · 보관", X[2], Y[0], 180, 56, KEY),
    N("s8", "구조 편집", "섹션 · 레슨 · 재정렬", X[3], Y[0], 180, 56, KEY),
    N("s9", "수강생 관리", "로스터 · 승인", X[2], Y[1], 180, 56, KEY),
    N("s10", "라이브 운영", "개설 · 시작 · 종료", X[3], Y[1], 180, 56, KEY),
    N("s11", "자료 업로드", "presigned", X[2], Y[2], 180, 56, KEY),
    N("s12", "녹화 관리", "Egress 제어", X[3], Y[2], 180, 56, KEY),

    Z("z3", "AI — CP2~CP3", X[0]-20, Y[3]+10, 940, 120),
    N("s13", "라이브 자막", "STT → Redis → WS", X[0], Y[3]+40, 180, 56, PLAN),
    N("s14", "용어·근거 RAG", "chunk · embed · SSE", X[1], Y[3]+40, 180, 56, PLAN),
    N("s15", "자료 파싱", "PPTX → chunk", X[2], Y[3]+40, 180, 56, PLAN),
    N("s16", "퀴즈", "CP5", X[3], Y[3]+40, 180, 56, PLAN),

    T("n1", "파랑 = 구현 완료 · 회색 점선 = 미착수. 각 슬라이스의 상세는 이 파일의 다음 탭들에 있다.",
      X[0], Y[4]+70, 940, 40),
]))

# ---------- 01 인증 ----------
D.append(("01 · 인증과 세션", [
    N("a1", "브라우저", "React", X[0], Y[1], 180, 56, ACTOR),
    N("a2", "nginx", "TLS 종단 · /api 프록시", X[1], Y[1], 180, 56, BUILT),
    N("a3", "auth 모듈", "AuthController", X[2], Y[1], 180, 56, KEY),
    N("a4", "Spring Security", "필터 체인 · CSRF", X[2], Y[0], 180, 56, BUILT),
    N("a5", "Redis", "세션 저장소", X[3], Y[0], 180, 60, DATA),
    N("a6", "PostgreSQL", "app_user · instructor_profile", X[3], Y[2], 180, 60, DATA),
    N("a7", "asset 모듈", "프로필 이미지", X[2], Y[2], 180, 56, BUILT),

    L("a1", "a2", "① HTTPS"),
    L("a2", "a3", "② /api/auth/*"),
    L("a3", "a4", "③ 인증 위임"),
    L("a4", "a5", "④ 세션 생성·조회"),
    L("a3", "a6", "⑤ 계정 조회·저장"),
    L("a3", "a7", "PUT /api/me/profile-image", E_BACK),
    L("a2", "a1", "⑥ Set-Cookie: LIVECLASS_SESSION (HttpOnly)", E_BACK),

    T("n1", "엔드포인트 — POST /api/auth/signup · /login · /logout · GET /api/auth/me · /csrf · /email-availability<br><br>"
            "식별자는 email. 쿠키는 HttpOnly + SameSite, 운영은 secure=true. 세션이 Redis에 있어 백엔드는 이미 stateless다 — "
            "수평 확장의 유일한 걸림돌은 채팅 브로커(탭 07).",
      X[0], Y[3], 940, 120),
]))

# ---------- 02 카탈로그 ----------
D.append(("02 · 커리큘럼 탐색 (공개)", [
    N("c1", "누구나", "비로그인 포함", X[0], Y[1], 180, 56, ACTOR),
    N("c2", "CatalogController", "GET /api/curriculums", X[1], Y[1], 180, 56, KEY),
    N("c3", "CatalogService", "검색 · 정렬 · 페이지", X[2], Y[1], 180, 56, BUILT),
    N("c4", "curriculum", "커리큘럼 · 섹션 · 목차", X[3], Y[0], 180, 56, BUILT),
    N("c5", "auth.api", "강사 프로필", X[3], Y[1], 180, 56, BUILT),
    N("c6", "enrollment.api", "내 수강 관계", X[3], Y[2], 180, 56, BUILT),
    N("c7", "video.api", "다시보기 유무", X[3], Y[3], 180, 56, BUILT),

    L("c1", "c2", "① q · sort · page"),
    L("c2", "c3", "② 뷰어 식별"),
    L("c3", "c4", "③"),
    L("c3", "c5", "④ 배치 조회"),
    L("c3", "c6", "⑤ viewerContext"),
    L("c3", "c7", "⑥"),

    T("n1", "PUBLISHED 만 노출한다. DRAFT 상세는 404 — 존재 여부조차 흘리지 않는다.<br><br>"
            "로그인 상태면 카드마다 viewerContext(내 관계·가능한 행동)가 채워진다. "
            "N+1 을 막으려고 강사 프로필·수강 관계·다시보기 유무를 전부 배치로 조회한다. "
            "page 상한이 없으면 오프셋이 int 를 넘겨 500 이 나서 PageParams 로 잘라 낸다.",
      X[0], Y[4], 940, 120),
]))

# ---------- 03 커리큘럼 관리 ----------
D.append(("03 · 커리큘럼 관리 (강사)", [
    N("m1", "강사", "INSTRUCTOR", X[0], Y[1], 180, 56, ACTOR),
    N("m2", "InstructorCurriculumController", "/api/instructor/curriculums", X[1], Y[1], 200, 56, KEY),
    N("m3", "소유권 가드", "본인 커리큘럼만", X[1], Y[0], 200, 56, BUILT),
    N("m4", "InstructorCurriculumService", "생성 · 수정 · 발행 · 보관", X[2]+20, Y[1], 200, 56, BUILT),
    N("m5", "curriculum", "lifecycle_status", X[3]+40, Y[0], 180, 56, DATA),
    N("m6", "lesson.api", "발행 가능 레슨 수", X[3]+40, Y[1], 180, 56, BUILT),
    N("m7", "live.api", "다음 예정 세션", X[3]+40, Y[2], 180, 56, BUILT),

    L("m1", "m2", "① 로그인 쿠키"),
    L("m2", "m3", "② 역할·소유 검증"),
    L("m2", "m4", "③"),
    L("m4", "m5", "④ DRAFT ↔ PUBLISHED ↔ ARCHIVED"),
    L("m4", "m6", "⑤ 목록 배치"),
    L("m4", "m7", "⑥ nextLiveSession 배치"),

    T("n1", "엔드포인트 — POST · GET /api/instructor/curriculums · GET/PATCH /{id} · POST /{id}/publish · /{id}/archive<br><br>"
            "목록의 nextLiveSession 은 '예정 또는 진행 중'이다 — 종료·취소·실패 상태는 제외하고, "
            "지난 세션이 다음 일정인 척하지 않게 한다. 커리큘럼 N개에 쿼리 1번(배치).",
      X[0], Y[3], 940, 100),
]))

# ---------- 04 구조 편집 ----------
D.append(("04 · 섹션·레슨 구조 편집", [
    N("s1", "강사", None, X[0], Y[1], 180, 56, ACTOR),
    N("s2", "StructureController", "PUT .../curriculum/order", X[1], Y[1], 200, 56, KEY),
    N("s3", "SectionController", "섹션 CRUD", X[1], Y[0], 200, 56, BUILT),
    N("s4", "LessonController", "레슨 CRUD · 발행", X[1], Y[2], 200, 56, BUILT),
    N("s5", "구조 버전 CAS", "structure_version 조건부 UPDATE", X[2]+20, Y[1], 210, 56, KEY),
    N("s6", "section / lesson", "DEFERRABLE 유니크 제약", X[3]+40, Y[1], 190, 60, DATA),
    N("s7", "409 STRUCTURE_VERSION_CONFLICT", "다른 편집이 먼저 반영됨", X[2]+20, Y[2], 210, 56, EXT),

    L("s1", "s2", "① 순서 전체 + 기대 버전"),
    L("s2", "s5", "② 버전 일치 확인"),
    L("s5", "s6", "③ 한 트랜잭션에서 재정렬"),
    L("s5", "s7", "④ 불일치면", E_HOT),
    L("s3", "s5", "구조 변경 시 버전 증가", E_BACK),
    L("s4", "s5", "", E_BACK),

    T("n1", "낙관적 락(@Version) 대신 조건부 원자 UPDATE 를 골랐다 — 재정렬은 여러 행을 한꺼번에 바꾸므로 "
            "엔티티 단위 버전으로는 '구조 전체'의 동시 편집을 못 막는다.<br><br>"
            "유니크 제약이 DEFERRABLE INITIALLY DEFERRED 라 임시값으로 우회하지 않고 한 트랜잭션에서 순서를 맞바꾼다. "
            "order 는 0-based.",
      X[0], Y[3], 940, 110),
]))

# ---------- 05 수강 ----------
D.append(("05 · 수강 신청과 승인", [
    N("e1", "학생", None, X[0], Y[0], 180, 56, ACTOR),
    N("e2", "EnrollmentController", "POST /api/curriculums/{id}/enrollments", X[1], Y[0], 220, 56, KEY),
    N("e3", "즉시 등록", "IMMEDIATE → ACTIVE", X[2]+40, Y[0], 180, 56, BUILT),
    N("e4", "승인 대기", "APPROVAL → PENDING", X[2]+40, Y[1], 180, 56, BUILT),
    N("e5", "강사", None, X[0], Y[2], 180, 56, ACTOR),
    N("e6", "로스터 API", "GET .../enrollments", X[1], Y[2], 220, 56, KEY),
    N("e7", "승인 · 거절 · 해지", "approve / reject / revoke", X[2]+40, Y[2], 180, 56, BUILT),
    N("e8", "enrollment", "@Version 낙관적 락", X[3]+40, Y[1], 180, 60, DATA),

    L("e1", "e2", "① 신청"),
    L("e2", "e3", "② 즉시형"),
    L("e2", "e4", "③ 승인형"),
    L("e5", "e6", "④ 페이지 · 상태 필터 · 요약"),
    L("e6", "e7", "⑤"),
    L("e3", "e8", ""),
    L("e4", "e8", ""),
    L("e7", "e8", "⑥ 상태 전이"),

    T("n1", "@Version 이 있는 이유 — 승인과 학생의 자진 해지가 동시에 들어오면 갱신 하나가 사라져 "
            "해지한 학생이 ACTIVE 로 남을 수 있다. 충돌은 전역 핸들러가 409 로 바꾼다.<br><br>"
            "수강 상태는 라이브 입장·다시보기 접근의 게이트다(탭 06·09). "
            "이름 검색(q)은 크로스모듈 조인이라 보류.",
      X[0], Y[3], 940, 110),
]))

# ---------- 06 라이브 세션 ----------
D.append(("06 · 라이브 세션 수명주기", [
    N("l1", "강사", None, X[0], Y[0], 160, 50, ACTOR),
    N("l2", "학생", None, X[0], Y[2], 160, 50, ACTOR),
    N("l3", "LiveSessionController", "개설 · 시작 · 종료 · 취소", X[1], Y[0], 210, 56, KEY),
    N("l4", "accessGuard", "수강 확인", X[1], Y[2], 210, 56, KEY),
    N("l5", "상태 기계", "SCHEDULED → OPEN → LIVE → ENDED", X[2]+30, Y[0], 210, 56, BUILT),
    N("l6", "토큰 발급", "LiveKit JWT · 익명 identity", X[2]+30, Y[2], 210, 56, KEY),
    N("l7", "LiveKit SFU", "WebRTC", X[3]+50, Y[1], 170, 56, BUILT),
    N("l8", "video 모듈", "Egress 시작·정지", X[2]+30, Y[1], 210, 56, BUILT),
    N("l9", "live_session", "curriculum_id 비정규화", X[3]+50, Y[3], 170, 60, DATA),

    L("l1", "l3", "① 세션 개설·시작"),
    L("l3", "l5", "②"),
    L("l5", "l8", "③ 세션 시작 이벤트"),
    L("l8", "l7", "④ 녹화 시작"),
    L("l2", "l4", "⑤ 입장 요청"),
    L("l4", "l6", "⑥ 수강 ACTIVE 확인"),
    L("l6", "l7", "⑦ 토큰 제시 후 직접 입장", E_HOT),
    L("l5", "l9", ""),
    L("l1", "l7", "⑧ 화면·음성 송출", E_HOT),

    T("n1", "identity 는 원본 userId 가 아니라 (세션, 사용자) 해시다 — 참가자 목록으로 내부 ID 가 새지 않는다.<br><br>"
            "live → curriculum 순환이 모듈 규칙에 막혀 live_session 에 curriculum_id 를 비정규화했고, "
            "덕분에 수강 검사가 조인 없이 끝난다. 세션 조회에도 accessGuard 가 걸려 있다.",
      X[0], Y[4], 940, 110),
]))

# ---------- 07 채팅 ----------
D.append(("07 · 실시간 채팅", [
    N("w1", "브라우저", "STOMP 클라이언트", X[0], Y[1], 180, 56, ACTOR),
    N("w2", "핸드셰이크", "/api/ws · 쿠키 세션으로 인증", X[1], Y[0], 210, 56, KEY),
    N("w3", "SUBSCRIBE 인터셉터", "경로 화이트리스트", X[1], Y[1], 210, 56, KEY),
    N("w4", "ChatWsController", "/app 수신", X[1], Y[2], 210, 56, BUILT),
    N("w5", "SimpleBroker", "/topic — 인메모리", X[2]+30, Y[1], 200, 56, BUILT),
    N("w6", "chat_message", "영속", X[3]+40, Y[2], 180, 60, DATA),
    N("w7", "외부 브로커", "STOMP relay · CP3", X[2]+30, Y[0], 200, 56, PLAN),

    L("w1", "w2", "① 연결"),
    L("w2", "w3", "② Principal = userId"),
    L("w3", "w5", "③ 구독 허용"),
    L("w1", "w4", "④ 메시지 전송"),
    L("w4", "w6", "⑤ 저장"),
    L("w4", "w5", "⑥ 브로드캐스트"),
    L("w5", "w1", "⑦ /topic/live-sessions/{id}/chat", E_BACK),
    L("w5", "w7", "수평 확장 시 교체", E_PLAN),

    T("n1", "SimpleBroker 는 구독 경로를 패턴으로 매칭한다 — 와일드카드로 구독하면 남의 방 채팅이 흘러들어온다. "
            "그래서 인터셉터가 정확히 /topic/live-sessions/{id}/chat 형태만 통과시킨다.<br><br>"
            "브로커가 인메모리라 브로드캐스트가 인스턴스 로컬이다. 백엔드를 2대로 늘리는 순간 채팅이 갈리므로, "
            "RabbitMQ 를 들이는 CP3 에 STOMP relay 로 함께 전환한다.",
      X[0], Y[3], 940, 120),
]))

# ---------- 08 자료 업로드 ----------
D.append(("08 · 자료 업로드 (presigned)", [
    N("u1", "브라우저", None, X[0], Y[1], 180, 56, ACTOR),
    N("u2", "AssetController", "POST /api/assets/upload-requests", X[1], Y[0], 220, 56, KEY),
    N("u3", "검증", "소유 · 용량 · MIME", X[2]+20, Y[0], 190, 56, BUILT),
    N("u4", "MinIO / S3", "오브젝트 스토리지", X[3]+30, Y[1], 180, 60, DATA),
    N("u5", "complete", "POST /api/assets/{id}/complete", X[1], Y[2], 220, 56, KEY),
    N("u6", "재검증", "실제 크기·타입 HEAD", X[2]+20, Y[2], 190, 56, BUILT),
    N("u7", "asset", "PENDING → UPLOADED", X[3]+30, Y[3], 180, 60, DATA),
    N("u8", "리퍼", "방치된 PENDING → FAILED", X[1], Y[3], 220, 56, BUILT),
    N("u9", "material_asset", "레슨 연결 — 미구현", X[2]+20, Y[1], 190, 56, PLAN),

    L("u1", "u2", "① 업로드 티켓 요청"),
    L("u2", "u3", "②"),
    L("u3", "u7", "③ PENDING 행 생성"),
    L("u2", "u1", "④ presigned URL (만료 있음)", E_BACK),
    L("u1", "u4", "⑤ 직접 PUT — Spring 우회", E_HOT),
    L("u1", "u5", "⑥ 완료 통보"),
    L("u5", "u6", "⑦"),
    L("u6", "u4", "⑧ HEAD 로 실제 확인"),
    L("u6", "u7", "⑨ UPLOADED"),
    L("u8", "u7", "주기 정리"),
    L("u7", "u9", "여기가 끊겨 있다", E_PLAN),

    T("n1", "클라이언트가 보낸 크기·타입을 믿지 않는다 — 완료 시 스토리지에 직접 물어 실제 값을 확인한다.<br><br>"
            "끊긴 지점: 업로드는 되지만 자료를 레슨에 붙이는 API 가 없어 material_asset 이 비어 있다. "
            "CP3 RAG 의 입력이 여기서 막힌다. 프론트 목은 multipart 로 파일을 직접 보내는데, "
            "실제 API 는 이 presigned 2단계를 따라야 한다.",
      X[0], Y[4], 940, 120),
]))

# ---------- 09 녹화·다시보기 ----------
D.append(("09 · 녹화와 다시보기", [
    N("r1", "LiveEndOrchestrator", "동기 순차", X[0], Y[0], 180, 56, BUILT),
    N("r2", "LiveRecordingControl", "동기 포트", X[1], Y[0], 210, 56, BUILT),
    N("r3", "EgressControl", "시작 · 정지", X[2]+20, Y[0], 190, 56, BUILT),
    N("r4", "LiveKit Egress", "합성 → HLS", X[3]+30, Y[0], 180, 56, BUILT),
    N("r5", "MinIO / S3", "세그먼트 · manifest", X[3]+30, Y[1], 180, 60, DATA),
    N("r6", "video_asset", "REQUESTED → … → READY", X[2]+20, Y[1], 190, 60, DATA),
    N("r7", "ReplayDirectory", "다시보기 유무", X[1], Y[1], 210, 56, BUILT),
    N("r8", "카탈로그", "카드에 표시", X[0], Y[1], 180, 56, BUILT),
    N("r9", "재생 API", "GET /api/lessons/{id}/playback", X[1], Y[2], 210, 56, PLAN),
    N("r10", "HLS 플레이어", "manifest → 세그먼트", X[0], Y[2], 180, 56, PLAN),

    L("r1", "r2", "①"),
    L("r2", "r3", "②"),
    L("r3", "r4", "③"),
    L("r4", "r5", "④ 업로드"),
    L("r3", "r6", "⑤ 상태 추적"),
    L("r6", "r7", "⑥"),
    L("r7", "r8", "⑦"),
    L("r6", "r9", "⑧ 미착수", E_PLAN),
    L("r9", "r10", "⑨ 권한 검증 후 manifest", E_PLAN),
    L("r10", "r5", "⑩ 세그먼트 직접 수신", E_PLAN),

    T("n1", "여기까지는 돈다 — 세션이 끝나면 Egress 가 녹화를 올리고 video_asset 이 상태를 추적하며 "
            "카탈로그가 '다시보기 있음'을 표시한다.<br><br>"
            "남은 것은 재생이다. nginx secure_link 대신 presigned 로 통일하는 쪽을 제안한다 — "
            "manifest 만 Spring 이 프록시하며 세그먼트 URL 을 presigned 로 재작성하면 "
            "바이트는 여전히 스토리지 직결이고 S3 로 옮겨도 그대로 동작한다.",
      X[0], Y[3], 940, 120),
]))

# ---------- 10 AI 자막 ----------
D.append(("10 · 라이브 자막 (CP2)", [
    N("t1", "강사 오디오", "WebRTC", X[0], Y[1], 170, 56, BUILT),
    N("t2", "LiveKit SFU", "방당 1회 분기", X[1], Y[1], 170, 56, BUILT),
    N("t3", "realtime-agent", "VAD · 스트리밍 STT", X[2], Y[1], 170, 56, PLAN),
    N("t4", "외부 STT API", "model gateway", X[2], Y[0], 170, 56, PLAN),
    N("t5", "Redis Stream", "fast-path · 유실 허용", X[3], Y[1], 170, 56, PLAN),
    N("t6", "core-api", "consume → core 영속", X[4], Y[1], 170, 56, PLAN),
    N("t7", "학생 화면", "WS 자막", X[4], Y[2], 170, 56, PLAN),
    N("t8", "녹화본 2-pass", "유실 구간 복구", X[3], Y[2], 170, 56, PLAN),

    L("t1", "t2", "①"),
    L("t2", "t3", "②", E_PLAN),
    L("t3", "t4", "③", E_PLAN),
    L("t3", "t5", "④ partial · final", E_PLAN),
    L("t5", "t6", "⑤", E_PLAN),
    L("t6", "t7", "⑥ 지평선 뒤 교정본", E_PLAN),
    L("t8", "t6", "⑦ 사후 보정", E_PLAN),

    T("n1", "원본 자막의 소유자는 Spring 이다 — agent 는 스트림에 흘리기만 하고 영속은 core 가 한다. "
            "그래서 자막은 원본·게시본 모두 core 스키마에 있고 Python 은 chunking 을 위해 읽기만 한다.<br><br>"
            "미정 — 지평선의 길이(N초)와 확정 선언 주체. 정해지지 않으면 프론트는 렌더 정책을, "
            "백엔드는 영속 시점을 정할 수 없다.",
      X[0], Y[3], 940, 110),
]))

# ---------- 11 RAG ----------
D.append(("11 · 용어·근거 RAG (CP3)", [
    N("g1", "학생", "질문", X[0], Y[1], 170, 56, ACTOR),
    N("g2", "core-api", "인증 · 수강 · 정책 · 비용", X[1], Y[1], 190, 56, KEY),
    N("g3", "ai-api", "FastAPI", X[2]+10, Y[1], 170, 56, PLAN),
    N("g4", "pgvector", "FTS + vector · RRF", X[3]+10, Y[1], 170, 60, DATA),
    N("g5", "model gateway", "LLM", X[3]+10, Y[0], 170, 56, PLAN),
    N("g6", "ai-worker", "PPTX 파싱 · chunk · embed", X[2]+10, Y[2], 170, 56, PLAN),
    N("g7", "RabbitMQ", "잡 · 결과", X[1], Y[2], 190, 56, PLAN),
    N("g8", "자료 · 자막", "근거 원본", X[0], Y[2], 170, 56, PLAN),

    L("g1", "g2", "① 질문 + lessonId + 현재시각"),
    L("g2", "g3", "② 검증된 scope 만 전달", E_PLAN),
    L("g3", "g4", "③ 하이브리드 검색", E_PLAN),
    L("g3", "g5", "④ 프롬프트 + 근거", E_PLAN),
    L("g3", "g2", "⑤ SSE 토큰 스트림", E_PLAN),
    L("g2", "g1", "⑥ 중계 · 근거 없으면 INSUFFICIENT_EVIDENCE", E_PLAN),
    L("g8", "g7", "ingestion", E_PLAN),
    L("g7", "g6", "", E_PLAN),
    L("g6", "g4", "임베딩 적재", E_PLAN),

    T("n1", "Python 은 외부에 노출되지 않는다 — 권한·정책·비용 한도를 Spring 이 먼저 판정하고 "
            "검증된 scope 만 넘긴다.<br><br>"
            "근거가 없으면 답을 지어내지 않고 INSUFFICIENT_EVIDENCE 를 돌려준다. 모든 답변에 citation 을 붙인다. "
            "선행 조건 — 자료를 레슨에 붙이는 API(탭 08).",
      X[0], Y[3], 940, 110),
]))

# ---------- 12 배포 ----------
D.append(("12 · 배포 토폴로지", [
    Z("z1", "앱 스택 — docker-compose.prod.yml", X[1]-20, Y[0]-40, 460, 400),
    N("d1", "인터넷", None, X[0], Y[1], 150, 56, ACTOR),
    N("d2", "nginx", "TLS · SPA · /api 프록시", X[1], Y[0], 200, 56, BUILT),
    N("d3", "backend :8080", "호스트 미노출", X[1], Y[1], 200, 56, BUILT),
    N("d4", "postgres", "내부 전용", X[1], Y[2], 95, 60, DATA),
    N("d5", "redis", "내부 전용", X[1]+105, Y[2], 95, 60, DATA),
    N("d6", "certbot", "발급 · 12h 갱신", X[1], Y[3], 200, 50, BUILT),

    Z("z2", "미디어 스택 — network_mode: host", X[3]-20, Y[0]-40, 240, 400),
    N("d7", "nginx-livekit", ":7443 시그널링 TLS", X[3], Y[0], 200, 56, BUILT),
    N("d8", "livekit", "SFU :7880", X[3], Y[1], 200, 56, BUILT),
    N("d9", "egress", "녹화 → HLS", X[3], Y[2], 200, 56, BUILT),
    N("d10", "minio", "오브젝트", X[3], Y[3], 200, 50, DATA),

    L("d1", "d2", "① :443 / :80"),
    L("d1", "d7", "② :7443"),
    L("d1", "d8", "③ :7882/udp · :7881/tcp", E_HOT),
    L("d2", "d3", ""),
    L("d3", "d4", ""),
    L("d3", "d5", ""),
    L("d7", "d8", ""),
    L("d8", "d9", ""),
    L("d9", "d10", ""),
    L("d6", "d7", "인증서 볼륨 공유 (읽기 전용)", E_BACK),

    T("n1", "도메인이 하나뿐이고 DNS 콘솔 권한이 없어 서브도메인 대신 포트로 분리했다. "
            "미디어 스택은 SFU 가 UDP 포트를 직접 잡아야 해서 도커 NAT 를 우회한다.<br><br>"
            "두 스택은 라이프사이클이 분리돼 있다 — 앱을 재배포해도 라이브 세션이 끊기지 않는다. "
            "결합은 인증서 파일 하나뿐이고 발급 소유권은 앱 스택에 있다.",
      X[0], Y[4]-40, 940, 110),
]))

# ---------- 13 모듈 ----------
D.append(("13 · 백엔드 모듈 의존", [
    N("k1", "curriculum", "카탈로그 · 구조 · 발행", 420, 40, 200, 54, KEY),
    N("k2", "video", "Egress · 녹화물", 300, 160, 180, 54, BUILT),
    N("k3", "live", "세션 · 토큰 · 채팅", 560, 160, 180, 54, BUILT),
    N("k4", "lesson", "레슨 · 자료", 300, 280, 180, 54, BUILT),
    N("k5", "enrollment", "수강 · 로스터", 560, 280, 180, 54, BUILT),
    N("k6", "asset", "presigned 업로드", 300, 400, 180, 54, BUILT),
    N("k7", "auth", "계정 · 세션", 560, 400, 180, 54, BUILT),
    N("k8", "learning", "배선 없음", 820, 160, 160, 50, PLAN),
    N("k9", "aiintegration", "배선 없음", 820, 240, 160, 50, PLAN),
    N("k10", "common", "공용 · 무의존", 820, 400, 160, 50, EXT),

    L("k1", "k2"), L("k1", "k4"), L("k1", "k5"), L("k1", "k6"), L("k1", "k7"),
    L("k2", "k3"), L("k2", "k4"),
    L("k3", "k4"), L("k3", "k5"), L("k3", "k7"),
    L("k4", "k6"), L("k5", "k7"),

    T("n1", "화살표는 의존 방향이다. 접근은 &lt;module&gt;.api 공개면으로만 — 남의 domain·repository 직접 호출 금지. "
            "순환 금지. 위반은 리뷰어가 아니라 ModularityTests 가 빌드에서 잡는다.<br><br>"
            "포트는 필요한 모듈만 만든다 — 열 개 중 .api 를 가진 건 여섯 개이고 curriculum 은 유입이 없어 포트가 없다. "
            "이 게이트가 실제로 잡은 것: video→live.config 결합, CatalogService 계층 역전, live→curriculum 순환.",
      40, 480, 940, 120),
]))

# ---------- 14 스키마 ----------
D.append(("14 · 스키마 소유권", [
    N("q1", "Spring · core-api", "Flyway", X[0]+40, Y[0], 260, 50, BUILT),
    N("q2", "Python · worker / api", "Alembic · CP2~", X[3]-40, Y[0], 260, 50, PLAN),
    N("q3", "스키마 core", "app_user · curriculum · section · lesson · live_session · "
                        "enrollment · asset · chat_message · outbox · inbox · 자막 게시본",
      X[0]+40, Y[1], 260, 200, DATA),
    N("q4", "스키마 ai", "document_chunk · chunk_embedding · job_run · model_run — 네 개뿐",
      X[3]-40, Y[1], 260, 200, DATA),
    N("q5", "이벤트 버스", "outbox → 큐 → inbox", X[2]-60, Y[2], 200, 56, PLAN),

    L("q1", "q3", "write 독점"),
    L("q2", "q4", "write 독점", E_PLAN),
    L("q4", "q3", "읽기 — chunking 원본", E_PLAN),
    L("q5", "q3", "AI 산출물은 이 경로로만", E_PLAN),
    L("q4", "q5", "", E_PLAN),

    T("n1", "소유 기준은 write-owner — 런타임에 그 행을 INSERT/UPDATE 하는 서비스가 갖는다.<br><br>"
            "벡터 인덱스를 ai 가 갖는 이유: Python 이 임베딩(쓰기)과 검색(읽기) 양쪽이라, core 로 빼면 "
            "수천 청크의 벡터를 이벤트로 실어 나르고 검색이 크로스플레인이 된다.<br>"
            "읽기는 grant 로 서로 허용, 쓰기는 절대 교차 없음. 스키마를 넘는 FK 없이 논리 참조 + 앱 검증.",
      X[0]+40, Y[4]-40, 940, 120),
]))

print(render(D, "liveclass-architecture.generated.drawio"), "개 탭 생성")
