-- V1__init_core.sql — CP0 core 스키마 (LiveClass AI)
-- core 스키마 15개 테이블 + 제약(FK/UNIQUE/CHECK) + 카운터 트리거 + 인덱스.
-- 관련 ADR: 0017(core/ai 스키마 경계) · 0018(PK 전략) · 0006(Spring/Python 분리).
-- 도메인 PK=uuid(v4), 고빈도 append PK=bigint identity. 시간은 세션 상대 ms.

CREATE SCHEMA IF NOT EXISTS core;

-- ── 1. app_user (profile_image FK는 asset 생성 후 추가: 순환 FK) ──
CREATE TABLE core.app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email varchar(320) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name varchar(100) NOT NULL,
  role varchar(20) NOT NULL CHECK (role IN ('STUDENT','INSTRUCTOR','OPERATOR')),
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','SUSPENDED','WITHDRAWN')),
  profile_image_asset_id uuid NULL,
  withdrawn_at timestamptz NULL,
  last_login_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.app_user IS '서비스 사용자(학생·강사·운영자) 계정. 인증·신원의 정본.';
COMMENT ON COLUMN core.app_user.id IS 'app_user 고유 식별자.';
COMMENT ON COLUMN core.app_user.email IS '로그인 수단(이메일). 유니크. 불변 신원은 id가 담당하며 이메일은 재인증으로 변경 가능.';
COMMENT ON COLUMN core.app_user.password_hash IS '단방향 해시 비밀번호. 응답 DTO에 절대 노출 안 함. 소셜 로그인 도입 시 nullable로 완화.';
COMMENT ON COLUMN core.app_user.display_name IS '화면에 표시할 사용자 이름(가변).';
COMMENT ON COLUMN core.app_user.role IS '전역 역할. 가입 경로로는 STUDENT/INSTRUCTOR만 생성, OPERATOR는 별도.';
COMMENT ON COLUMN core.app_user.status IS '계정 상태. PENDING=이메일 미인증, ACTIVE=정상, SUSPENDED=관리자 정지, WITHDRAWN=탈퇴.';
COMMENT ON COLUMN core.app_user.profile_image_asset_id IS '프로필 이미지 파일(asset) 참조. 없으면 NULL.';
COMMENT ON COLUMN core.app_user.withdrawn_at IS '탈퇴 시각. updated_at은 어떤 수정에도 바뀌므로 탈퇴 시점 보존을 위한 전용 컬럼(보존정책·감사용).';
COMMENT ON COLUMN core.app_user.last_login_at IS '마지막 로그인 성공 시각.';
COMMENT ON COLUMN core.app_user.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.app_user.updated_at IS '행 마지막 수정 시각.';

-- ── 2. asset ──
CREATE TABLE core.asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(30) NOT NULL CHECK (kind IN ('PROFILE_IMAGE','THUMBNAIL','MATERIAL')),
  bucket varchar(255) NOT NULL,
  object_key text NOT NULL,
  original_filename varchar(500) NULL,
  content_type varchar(255) NULL,
  size_bytes bigint NULL,
  checksum varchar(128) NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','UPLOADED','FAILED','DELETED')),
  uploaded_by uuid NULL REFERENCES core.app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bucket, object_key)
);
COMMENT ON TABLE core.asset IS '업로드 파일(presigned 방식)의 저장·상태 레코드. video(Egress 산출)는 제외하고 자체 테이블.';
COMMENT ON COLUMN core.asset.id IS 'asset 고유 식별자.';
COMMENT ON COLUMN core.asset.kind IS '파일 용도. PROFILE_IMAGE/THUMBNAIL/MATERIAL(PPTX).';
COMMENT ON COLUMN core.asset.bucket IS '객체 저장소 버킷.';
COMMENT ON COLUMN core.asset.object_key IS '버킷 내 비공개 파일 키. 사용자에게 노출 안 하고 URL은 온디맨드 발급.';
COMMENT ON COLUMN core.asset.original_filename IS '업로드 당시 원본 파일명(표시용).';
COMMENT ON COLUMN core.asset.content_type IS '파일 MIME 타입.';
COMMENT ON COLUMN core.asset.size_bytes IS '파일 크기(바이트).';
COMMENT ON COLUMN core.asset.checksum IS '무결성·내용 확인용 체크섬. (내용 중복 dedup은 MVP 미적용)';
COMMENT ON COLUMN core.asset.status IS 'presigned 업로드 상태. PENDING=URL 발급·대기, UPLOADED=검증 완료, FAILED, DELETED.';
COMMENT ON COLUMN core.asset.uploaded_by IS '업로드한 사용자.';
COMMENT ON COLUMN core.asset.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.asset.updated_at IS '행 마지막 수정 시각.';

ALTER TABLE core.app_user
  ADD CONSTRAINT fk_app_user_profile_image
  FOREIGN KEY (profile_image_asset_id) REFERENCES core.asset(id);

-- ── 3. instructor_profile (1:1) ──
CREATE TABLE core.instructor_profile (
  user_id uuid PRIMARY KEY REFERENCES core.app_user(id) ON DELETE CASCADE,
  bio text NULL,
  expertise text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.instructor_profile IS '강사 전용 공개 프로필(1:1). 학생에겐 없어 별도 테이블로 분리.';
COMMENT ON COLUMN core.instructor_profile.user_id IS 'app_user 참조(1:1, PK 겸 FK).';
COMMENT ON COLUMN core.instructor_profile.bio IS '강사 자기소개.';
COMMENT ON COLUMN core.instructor_profile.expertise IS '전문분야 태그 목록(단순 표시용 text[]).';
COMMENT ON COLUMN core.instructor_profile.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.instructor_profile.updated_at IS '행 마지막 수정 시각.';

-- ── 4. curriculum ──
CREATE TABLE core.curriculum (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instructor_id uuid NOT NULL REFERENCES core.app_user(id),
  title varchar(200) NOT NULL,
  summary varchar(500) NULL,
  description text NULL,
  thumbnail_asset_id uuid NULL REFERENCES core.asset(id),
  lifecycle_status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (lifecycle_status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  starts_at timestamptz NULL,
  ends_at timestamptz NULL,
  enrollment_type varchar(20) NOT NULL DEFAULT 'IMMEDIATE' CHECK (enrollment_type IN ('IMMEDIATE','APPROVAL_REQUIRED','INVITATION_ONLY')),
  enrollment_opens_at timestamptz NULL,
  enrollment_closes_at timestamptz NULL,
  structure_version integer NOT NULL DEFAULT 0,
  section_count integer NOT NULL DEFAULT 0,
  lesson_count integer NOT NULL DEFAULT 0,
  published_lesson_count integer NOT NULL DEFAULT 0,
  published_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.curriculum IS '강의 묶음(FE 표기 "커리큘럼"). curriculum→section→lesson 트리의 루트, 강사 소유.';
COMMENT ON COLUMN core.curriculum.id IS 'curriculum 고유 식별자.';
COMMENT ON COLUMN core.curriculum.instructor_id IS '소유 강사.';
COMMENT ON COLUMN core.curriculum.title IS '커리큘럼 제목.';
COMMENT ON COLUMN core.curriculum.summary IS '카드용 짧은 소개.';
COMMENT ON COLUMN core.curriculum.description IS '상세 설명.';
COMMENT ON COLUMN core.curriculum.thumbnail_asset_id IS '썸네일 이미지 asset 참조.';
COMMENT ON COLUMN core.curriculum.lifecycle_status IS '게시 생명주기. DRAFT=작성중, PUBLISHED=카탈로그 노출, ARCHIVED=보관. 수강 개폐(OPEN/NOT_OPEN)와는 다른 축.';
COMMENT ON COLUMN core.curriculum.starts_at IS '수강 기간 시작(nullable).';
COMMENT ON COLUMN core.curriculum.ends_at IS '수강 기간 종료(nullable).';
COMMENT ON COLUMN core.curriculum.enrollment_type IS '수강 정책. IMMEDIATE=즉시, APPROVAL_REQUIRED=승인, INVITATION_ONLY=초대.';
COMMENT ON COLUMN core.curriculum.enrollment_opens_at IS '수강 신청 시작. OPEN/NOT_OPEN은 이 창+현재시각으로 파생(저장 안 함).';
COMMENT ON COLUMN core.curriculum.enrollment_closes_at IS '수강 신청 마감(nullable).';
COMMENT ON COLUMN core.curriculum.structure_version IS '섹션/레슨 재정렬 낙관적 잠금 버전. 구조 변경마다 증가.';
COMMENT ON COLUMN core.curriculum.section_count IS '섹션 수(트리거 유지, 리스트 조회 최적화용 비정규화).';
COMMENT ON COLUMN core.curriculum.lesson_count IS '레슨 수(트리거 유지).';
COMMENT ON COLUMN core.curriculum.published_lesson_count IS '게시된 레슨 수(트리거 유지, lesson.status 전환 반영).';
COMMENT ON COLUMN core.curriculum.published_at IS '게시 시각(카탈로그 정렬용).';
COMMENT ON COLUMN core.curriculum.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.curriculum.updated_at IS '행 마지막 수정 시각.';

-- ── 5. section ──
CREATE TABLE core.section (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL REFERENCES core.curriculum(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  description text NULL,
  order_index integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_section_order UNIQUE (curriculum_id, order_index) DEFERRABLE INITIALLY DEFERRED
);
COMMENT ON TABLE core.section IS '커리큘럼의 단원(섹션). 레슨을 묶는 중간 계층.';
COMMENT ON COLUMN core.section.id IS 'section 고유 식별자.';
COMMENT ON COLUMN core.section.curriculum_id IS '소속 커리큘럼.';
COMMENT ON COLUMN core.section.title IS '섹션 제목.';
COMMENT ON COLUMN core.section.description IS '섹션 설명.';
COMMENT ON COLUMN core.section.order_index IS '커리큘럼 내 순서(1-based). 재정렬은 DEFERRABLE UNIQUE로 트랜잭션 내 스왑 허용.';
COMMENT ON COLUMN core.section.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.section.updated_at IS '행 마지막 수정 시각.';

-- ── 6. lesson ──
CREATE TABLE core.lesson (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL REFERENCES core.section(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  description text NULL,
  order_index integer NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','AI_NOT_READY','READY','PUBLISHED')),
  ai_ready_at timestamptz NULL,
  published_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_lesson_order UNIQUE (section_id, order_index) DEFERRABLE INITIALLY DEFERRED
);
COMMENT ON TABLE core.lesson IS '학습 최소 단위(한 차시). 라이브·자료·녹화·AI콘텐츠·진도·채팅이 모두 이 레슨에 붙는 중심 엔티티.';
COMMENT ON COLUMN core.lesson.id IS 'lesson 고유 식별자.';
COMMENT ON COLUMN core.lesson.section_id IS '소속 섹션.';
COMMENT ON COLUMN core.lesson.title IS '레슨 제목.';
COMMENT ON COLUMN core.lesson.description IS '레슨 설명.';
COMMENT ON COLUMN core.lesson.order_index IS '섹션 내 순서. 재정렬은 커리큘럼 구조 API(STRUCTURE-01), 같은 커리큘럼 안에서만 이동.';
COMMENT ON COLUMN core.lesson.status IS '작성 생명주기. DRAFT→AI_NOT_READY(자료 AI 처리중)→READY(게시 가능)→PUBLISHED. LIVE/ENDED는 live_session에서 파생.';
COMMENT ON COLUMN core.lesson.ai_ready_at IS 'AI 콘텐츠 처리가 준비된 시각.';
COMMENT ON COLUMN core.lesson.published_at IS '학생에게 게시한 시각.';
COMMENT ON COLUMN core.lesson.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.lesson.updated_at IS '행 마지막 수정 시각.';

-- ── 7. live_session (1:1 lesson) ──
CREATE TABLE core.live_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL UNIQUE REFERENCES core.lesson(id) ON DELETE CASCADE,
  instructor_id uuid NOT NULL REFERENCES core.app_user(id),
  status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SCHEDULED','OPEN','STARTING','LIVE','ENDING','ENDED','CANCELLED','FAILED')),
  scheduled_at timestamptz NULL,
  entry_window_minutes integer NULL,
  expected_duration_minutes integer NULL,
  room_sid varchar(255) NULL,
  started_at timestamptz NULL,
  clock_origin_at timestamptz NULL,
  ended_at timestamptz NULL,
  started_by uuid NULL REFERENCES core.app_user(id),
  recording_enabled boolean NOT NULL DEFAULT true,
  caption_enabled boolean NOT NULL DEFAULT true,
  chat_enabled boolean NOT NULL DEFAULT true,
  ai_qna_enabled boolean NOT NULL DEFAULT true,
  version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.live_session IS '레슨을 실시간 방송한 한 회차(1:1). LiveKit 방·녹화를 연결하고 모든 시간의 원점(started_at=t0)을 소유.';
COMMENT ON COLUMN core.live_session.id IS 'live_session 고유 식별자.';
COMMENT ON COLUMN core.live_session.lesson_id IS '방송하는 레슨(1:1).';
COMMENT ON COLUMN core.live_session.instructor_id IS '소유 강사(일정 충돌 검사용 비정규화. lesson→curriculum 조인 회피, 불변).';
COMMENT ON COLUMN core.live_session.status IS '방송 생명주기. DRAFT/SCHEDULED/OPEN(입장창)/STARTING/LIVE/ENDING/ENDED/CANCELLED/FAILED.';
COMMENT ON COLUMN core.live_session.scheduled_at IS '라이브 예정 시각.';
COMMENT ON COLUMN core.live_session.entry_window_minutes IS '입장 가능 창(분). entry_opens_at은 scheduled_at−이 값으로 파생.';
COMMENT ON COLUMN core.live_session.expected_duration_minutes IS '예상 진행 시간(분).';
COMMENT ON COLUMN core.live_session.room_sid IS 'LiveKit이 발급한 방 식별자. 방 이름(room_name)은 id에서 파생하므로 저장 안 함.';
COMMENT ON COLUMN core.live_session.started_at IS 'status가 LIVE로 전이한 시각(강사 시작).';
COMMENT ON COLUMN core.live_session.clock_origin_at IS '세션 상대 ms(session_ms=0)의 기준 t0 = 강사 오디오 첫 발행. 자막·채팅·VOD 정렬의 앵커.';
COMMENT ON COLUMN core.live_session.ended_at IS '실제 종료 시각.';
COMMENT ON COLUMN core.live_session.started_by IS '라이브를 시작한 사용자.';
COMMENT ON COLUMN core.live_session.recording_enabled IS '이 세션 녹화(→VOD) 여부.';
COMMENT ON COLUMN core.live_session.caption_enabled IS '실시간 자막(STT) 여부.';
COMMENT ON COLUMN core.live_session.chat_enabled IS '채팅 허용 여부.';
COMMENT ON COLUMN core.live_session.ai_qna_enabled IS '라이브 AI Q&A 허용 여부. (용어·퀴즈 등 enrichment는 레슨 후처리라 별개)';
COMMENT ON COLUMN core.live_session.version IS '상태 전이 동시성(이중 시작) 방지 낙관적 잠금.';
COMMENT ON COLUMN core.live_session.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.live_session.updated_at IS '행 마지막 수정 시각.';

-- ── 8. enrollment ──
CREATE TABLE core.enrollment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id uuid NOT NULL REFERENCES core.curriculum(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES core.app_user(id),
  status varchar(20) NOT NULL CHECK (status IN ('PENDING','ACTIVE','REJECTED','REVOKED','CANCELLED')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz NULL,
  enrolled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (curriculum_id, user_id)
);
COMMENT ON TABLE core.enrollment IS '학생↔커리큘럼 수강 관계. 접근 권한의 근거이자 강사 수강생명단·학생 내학습 목록의 원천.';
COMMENT ON COLUMN core.enrollment.id IS 'enrollment 고유 식별자.';
COMMENT ON COLUMN core.enrollment.curriculum_id IS '수강 대상 커리큘럼.';
COMMENT ON COLUMN core.enrollment.user_id IS '수강 학생.';
COMMENT ON COLUMN core.enrollment.status IS '수강 상태. PENDING(승인 대기)/ACTIVE/REJECTED/REVOKED(강퇴)/CANCELLED(학생 취소). 초깃값은 커리큘럼 정책에 따라 앱이 세팅.';
COMMENT ON COLUMN core.enrollment.requested_at IS '수강 신청 시각.';
COMMENT ON COLUMN core.enrollment.decided_at IS '승인/거절 결정 시각.';
COMMENT ON COLUMN core.enrollment.enrolled_at IS 'ACTIVE가 된 시각.';
COMMENT ON COLUMN core.enrollment.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.enrollment.updated_at IS '행 마지막 수정 시각.';

-- ── 9. learning_progress ──
CREATE TABLE core.learning_progress (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES core.app_user(id),
  lesson_id uuid NOT NULL REFERENCES core.lesson(id) ON DELETE CASCADE,
  last_position_ms bigint NOT NULL DEFAULT 0,
  progress_percent integer NOT NULL DEFAULT 0,
  watched_ranges jsonb NOT NULL DEFAULT '[]',
  completed_at timestamptz NULL,
  client_updated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);
COMMENT ON TABLE core.learning_progress IS '학생별·레슨별 진도(user,lesson 1:1). 이어보기 위치와 90% 완료 판정용 시청구간.';
COMMENT ON COLUMN core.learning_progress.id IS 'learning_progress 고유 식별자.';
COMMENT ON COLUMN core.learning_progress.user_id IS '학습자.';
COMMENT ON COLUMN core.learning_progress.lesson_id IS '진도 대상 레슨.';
COMMENT ON COLUMN core.learning_progress.last_position_ms IS '마지막 재생 위치(이어보기용).';
COMMENT ON COLUMN core.learning_progress.progress_percent IS '서버 계산 진도율 0~100.';
COMMENT ON COLUMN core.learning_progress.watched_ranges IS '병합된 시청 구간 [{startMs,endMs}...]. 유효 시청량(90% 완료) 계산 + "이미 봤음" 판정(되감기 감지)에 사용.';
COMMENT ON COLUMN core.learning_progress.completed_at IS '완료(90% 돌파) 시각. sticky. completed 여부는 이 값으로 파생.';
COMMENT ON COLUMN core.learning_progress.client_updated_at IS '순서역전 방어. 들어온 값이 저장값보다 클 때만 반영(진도 후퇴 방지).';
COMMENT ON COLUMN core.learning_progress.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.learning_progress.updated_at IS '행 마지막 수정 시각.';

-- ── 10. material_asset ──
CREATE TABLE core.material_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id uuid NOT NULL REFERENCES core.lesson(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES core.asset(id),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DELETING','DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.material_asset IS '레슨의 강의 자료(PPTX) 레코드. 파일 저장은 asset, AI 처리상태는 ai job_run(CP2), 여기엔 자료 생명주기만.';
COMMENT ON COLUMN core.material_asset.id IS 'material_asset 고유 식별자.';
COMMENT ON COLUMN core.material_asset.lesson_id IS '자료가 속한 레슨.';
COMMENT ON COLUMN core.material_asset.asset_id IS 'PPTX 파일(asset, kind=MATERIAL) 참조.';
COMMENT ON COLUMN core.material_asset.status IS '자료 생명주기. ACTIVE/DELETING(임베딩 정리중)/DELETED. (커리큘럼-레벨 자료는 CP2 RAG와 함께 확장)';
COMMENT ON COLUMN core.material_asset.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.material_asset.updated_at IS '행 마지막 수정 시각.';

-- ── 11. video_asset (1:0..1 live_session) ──
CREATE TABLE core.video_asset (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  live_session_id uuid NOT NULL UNIQUE REFERENCES core.live_session(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES core.lesson(id),
  egress_id varchar(255) NULL,
  status varchar(20) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','STARTING','RECORDING','FINALIZING','VERIFYING','READY','FAILED')),
  replay_status varchar(20) NOT NULL DEFAULT 'DRAFT' CHECK (replay_status IN ('DRAFT','READY_FOR_REVIEW','PUBLISHED','WITHDRAWN')),
  bucket varchar(255) NULL,
  hls_manifest_key text NULL,
  duration_ms bigint NULL,
  size_bytes bigint NULL,
  segment_count integer NULL,
  session_offset_ms bigint NULL,
  recording_started_at timestamptz NULL,
  recording_ended_at timestamptz NULL,
  ready_at timestamptz NULL,
  failure_code varchar(100) NULL,
  published_by uuid NULL REFERENCES core.app_user(id),
  published_at timestamptz NULL,
  withdraw_reason text NULL,
  retention_until timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.video_asset IS '라이브 녹화 → VOD(1:0..1 live_session). 기술 녹화 상태와 공개 상태를 독립 축으로 관리.';
COMMENT ON COLUMN core.video_asset.id IS 'video_asset 고유 식별자.';
COMMENT ON COLUMN core.video_asset.live_session_id IS '녹화된 라이브 세션(1:1).';
COMMENT ON COLUMN core.video_asset.lesson_id IS '소속 레슨(비정규화, VOD 직접 조회용. 불변).';
COMMENT ON COLUMN core.video_asset.egress_id IS 'LiveKit Egress 작업 식별자.';
COMMENT ON COLUMN core.video_asset.status IS '기술 녹화 상태(시스템). REQUESTED→STARTING→RECORDING→FINALIZING→VERIFYING→READY/FAILED.';
COMMENT ON COLUMN core.video_asset.replay_status IS '다시보기 공개 상태(강사 결정). DRAFT→READY_FOR_REVIEW→PUBLISHED→WITHDRAWN. 기술 status와 독립.';
COMMENT ON COLUMN core.video_asset.bucket IS 'HLS 녹화본 저장 버킷.';
COMMENT ON COLUMN core.video_asset.hls_manifest_key IS 'HLS 매니페스트 객체 키. 세그먼트는 스토리지 파일이고 DB엔 이 키+개수만.';
COMMENT ON COLUMN core.video_asset.duration_ms IS '녹화 길이(ms).';
COMMENT ON COLUMN core.video_asset.size_bytes IS '녹화 자산 크기(바이트).';
COMMENT ON COLUMN core.video_asset.segment_count IS 'HLS 세그먼트 개수.';
COMMENT ON COLUMN core.video_asset.session_offset_ms IS 'HLS 0초와 세션 t0의 차이(ms). 자막·채팅을 VOD에 정렬할 때 보정.';
COMMENT ON COLUMN core.video_asset.recording_started_at IS 'Egress 녹화 시작 시각.';
COMMENT ON COLUMN core.video_asset.recording_ended_at IS 'Egress 녹화 종료 시각.';
COMMENT ON COLUMN core.video_asset.ready_at IS '검증 완료·재생 가능해진 시각.';
COMMENT ON COLUMN core.video_asset.failure_code IS '녹화/검증 실패 코드.';
COMMENT ON COLUMN core.video_asset.published_by IS '다시보기를 게시한 사용자.';
COMMENT ON COLUMN core.video_asset.published_at IS '다시보기 게시 시각.';
COMMENT ON COLUMN core.video_asset.withdraw_reason IS '게시 철회 사유.';
COMMENT ON COLUMN core.video_asset.retention_until IS '녹화본 보존 기한.';
COMMENT ON COLUMN core.video_asset.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.video_asset.updated_at IS '행 마지막 수정 시각.';

-- ── 12. chat_message ──
CREATE TABLE core.chat_message (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  live_session_id uuid NOT NULL REFERENCES core.live_session(id) ON DELETE CASCADE,
  lesson_id uuid NOT NULL REFERENCES core.lesson(id),
  user_id uuid NOT NULL REFERENCES core.app_user(id),
  is_anonymous boolean NOT NULL DEFAULT false,
  sender_name varchar(100) NOT NULL,
  session_ms bigint NOT NULL,
  text text NOT NULL,
  is_question boolean NOT NULL DEFAULT false,
  client_message_id varchar(64) NOT NULL,
  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (live_session_id, client_message_id)
);
COMMENT ON TABLE core.chat_message IS '라이브 채팅(고빈도 append). 유튜브 라이브식 실시간. 익명 선택 가능, 삭제는 관리자/강사만.';
COMMENT ON COLUMN core.chat_message.id IS 'chat_message 고유 식별자.';
COMMENT ON COLUMN core.chat_message.live_session_id IS '연결된 라이브 세션.';
COMMENT ON COLUMN core.chat_message.lesson_id IS '연결된 레슨(비정규화).';
COMMENT ON COLUMN core.chat_message.user_id IS '작성자. 제재·신고용으로 저장하되 응답에는 절대 노출 안 함.';
COMMENT ON COLUMN core.chat_message.is_anonymous IS '학생의 익명 선택 여부.';
COMMENT ON COLUMN core.chat_message.sender_name IS '화면 표시명 스냅샷(익명이면 별명, 아니면 그 시점 display_name). 이름 변경에 안 흔들리게 스냅샷.';
COMMENT ON COLUMN core.chat_message.session_ms IS '서버 수신 세션 상대 시각(리플레이 정렬 기준).';
COMMENT ON COLUMN core.chat_message.text IS '메시지 본문.';
COMMENT ON COLUMN core.chat_message.is_question IS '질문으로 등록된 채팅(강사용 질문 핀 집계 소스).';
COMMENT ON COLUMN core.chat_message.client_message_id IS '멱등 발송 키. UNIQUE로 더블 전송 차단.';
COMMENT ON COLUMN core.chat_message.deleted_at IS '관리자/강사 삭제(소프트). 리플레이에서 제외.';
COMMENT ON COLUMN core.chat_message.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.chat_message.updated_at IS '행 마지막 수정 시각.';

-- ── 13. bookmark ──
CREATE TABLE core.bookmark (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES core.app_user(id),
  lesson_id uuid NOT NULL REFERENCES core.lesson(id) ON DELETE CASCADE,
  session_ms bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id, session_ms)
);
COMMENT ON TABLE core.bookmark IS '학생의 개인 타임라인 마커(레슨당 여러 개). 이어보기(진도 1개)와 다른 수동 저장 기능. 라이브·VOD 공통.';
COMMENT ON COLUMN core.bookmark.id IS 'bookmark 고유 식별자.';
COMMENT ON COLUMN core.bookmark.user_id IS '북마크 소유 학생.';
COMMENT ON COLUMN core.bookmark.lesson_id IS '북마크 대상 레슨.';
COMMENT ON COLUMN core.bookmark.session_ms IS '북마크한 타임라인 위치(라이브/VOD 공통).';
COMMENT ON COLUMN core.bookmark.created_at IS '행 생성 시각.';

-- ── 14. outbox_events ──
CREATE TABLE core.outbox_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate_type varchar(100) NOT NULL,
  aggregate_id varchar(64) NOT NULL,
  event_type varchar(150) NOT NULL,
  payload_json jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PUBLISHED','FAILED')),
  idempotency_key varchar(255) NOT NULL UNIQUE,
  correlation_id varchar(128) NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz NULL,
  locked_by varchar(128) NULL,
  last_error text NULL,
  published_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.outbox_events IS 'Spring→큐(RabbitMQ) 발행 신뢰성(transactional outbox). 도메인 변경과 한 트랜잭션에 쓰고 릴레이가 발행. CP2부터 활성.';
COMMENT ON COLUMN core.outbox_events.id IS 'outbox_events 고유 식별자.';
COMMENT ON COLUMN core.outbox_events.aggregate_type IS '이벤트 발생 애그리거트 종류(예: lesson, material_asset).';
COMMENT ON COLUMN core.outbox_events.aggregate_id IS '애그리거트 id(문자열; uuid/bigint 무관. 로그라 FK 없음).';
COMMENT ON COLUMN core.outbox_events.event_type IS '이벤트 타입(예: LESSON_AI_REQUESTED).';
COMMENT ON COLUMN core.outbox_events.payload_json IS '이벤트 페이로드(JSON).';
COMMENT ON COLUMN core.outbox_events.status IS '발행 상태. PENDING→PUBLISHED/FAILED.';
COMMENT ON COLUMN core.outbox_events.idempotency_key IS '중복 발행 방지 키(UNIQUE). outbox의 존재 이유.';
COMMENT ON COLUMN core.outbox_events.correlation_id IS '서비스 간 요청 추적(React→Spring→AI→Worker).';
COMMENT ON COLUMN core.outbox_events.attempt_count IS '발행 시도 횟수.';
COMMENT ON COLUMN core.outbox_events.next_attempt_at IS '다음 발행 시도 시각. (status, next_attempt_at) 인덱스로 릴레이가 폴링.';
COMMENT ON COLUMN core.outbox_events.locked_at IS '릴레이가 선점한 시각.';
COMMENT ON COLUMN core.outbox_events.locked_by IS '다중 릴레이가 SELECT ... FOR UPDATE SKIP LOCKED로 선점한 흔적.';
COMMENT ON COLUMN core.outbox_events.last_error IS '마지막 발행 오류.';
COMMENT ON COLUMN core.outbox_events.published_at IS '발행 완료 시각.';
COMMENT ON COLUMN core.outbox_events.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.outbox_events.updated_at IS '행 마지막 수정 시각.';

-- ── 15. external_event_inbox (복합 PK = 멱등) ──
CREATE TABLE core.external_event_inbox (
  source varchar(100) NOT NULL,
  source_event_id varchar(255) NOT NULL,
  event_type varchar(150) NOT NULL,
  aggregate_ref varchar(255) NULL,
  payload_json jsonb NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','PROCESSED','FAILED')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL,
  error_detail text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source, source_event_id)
);
COMMENT ON TABLE core.external_event_inbox IS '외부(ai-worker)→Spring 멱등 수신. 복합 PK로 같은 이벤트 재수신 시 한 번만 처리. CP2부터 활성.';
COMMENT ON COLUMN core.external_event_inbox.source IS '발신 시스템(예: ai-worker).';
COMMENT ON COLUMN core.external_event_inbox.source_event_id IS '발신측 이벤트 id. (source,이 값)이 멱등키 겸 PK.';
COMMENT ON COLUMN core.external_event_inbox.event_type IS '이벤트 타입.';
COMMENT ON COLUMN core.external_event_inbox.aggregate_ref IS '연관 애그리거트 참조(논리, FK 없음).';
COMMENT ON COLUMN core.external_event_inbox.payload_json IS '이벤트 페이로드(JSON).';
COMMENT ON COLUMN core.external_event_inbox.status IS '처리 상태. RECEIVED→PROCESSED/FAILED.';
COMMENT ON COLUMN core.external_event_inbox.received_at IS '수신 시각.';
COMMENT ON COLUMN core.external_event_inbox.processed_at IS '처리 완료 시각.';
COMMENT ON COLUMN core.external_event_inbox.error_detail IS '처리 실패 상세.';
COMMENT ON COLUMN core.external_event_inbox.created_at IS '행 생성 시각.';
COMMENT ON COLUMN core.external_event_inbox.updated_at IS '행 마지막 수정 시각.';

-- ══ 카운터 트리거 (curriculum.section_count / lesson_count / published_lesson_count) ══
CREATE FUNCTION core.trg_section_count() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE core.curriculum SET section_count = section_count + 1 WHERE id = NEW.curriculum_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE core.curriculum SET section_count = section_count - 1 WHERE id = OLD.curriculum_id;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_section_count
  AFTER INSERT OR DELETE ON core.section
  FOR EACH ROW EXECUTE FUNCTION core.trg_section_count();

CREATE FUNCTION core.trg_lesson_count() RETURNS trigger AS $$
DECLARE cur_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT curriculum_id INTO cur_id FROM core.section WHERE id = NEW.section_id;
    UPDATE core.curriculum
      SET lesson_count = lesson_count + 1,
          published_lesson_count = published_lesson_count + (CASE WHEN NEW.status = 'PUBLISHED' THEN 1 ELSE 0 END)
      WHERE id = cur_id;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT curriculum_id INTO cur_id FROM core.section WHERE id = OLD.section_id;
    IF cur_id IS NOT NULL THEN
      UPDATE core.curriculum
        SET lesson_count = lesson_count - 1,
            published_lesson_count = published_lesson_count - (CASE WHEN OLD.status = 'PUBLISHED' THEN 1 ELSE 0 END)
        WHERE id = cur_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      SELECT curriculum_id INTO cur_id FROM core.section WHERE id = NEW.section_id;
      UPDATE core.curriculum
        SET published_lesson_count = published_lesson_count
              + (CASE WHEN NEW.status = 'PUBLISHED' THEN 1 ELSE 0 END)
              - (CASE WHEN OLD.status = 'PUBLISHED' THEN 1 ELSE 0 END)
        WHERE id = cur_id;
    END IF;
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_lesson_count
  AFTER INSERT OR DELETE OR UPDATE OF status ON core.lesson
  FOR EACH ROW EXECUTE FUNCTION core.trg_lesson_count();

-- ══ 인덱스 ══
CREATE INDEX ix_curriculum_catalog ON core.curriculum (lifecycle_status, published_at DESC);
CREATE INDEX ix_curriculum_instructor ON core.curriculum (instructor_id);
CREATE INDEX ix_lesson_section ON core.lesson (section_id);
CREATE INDEX ix_live_session_sched ON core.live_session (instructor_id, scheduled_at);
CREATE INDEX ix_enrollment_user ON core.enrollment (user_id, status);
CREATE INDEX ix_enrollment_curriculum ON core.enrollment (curriculum_id, status);
CREATE INDEX ix_material_lesson ON core.material_asset (lesson_id);
CREATE INDEX ix_video_lesson ON core.video_asset (lesson_id);
CREATE INDEX ix_chat_session_time ON core.chat_message (live_session_id, session_ms);
CREATE INDEX ix_outbox_poll ON core.outbox_events (status, next_attempt_at);
