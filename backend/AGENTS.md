# AGENTS.md — Backend / 컨트롤 플레인 (Spring Boot)

> 📍 정본 규칙: [../AGENTS.md](../AGENTS.md) · 공유 계약: [../docs/CONTRACT.md](../docs/CONTRACT.md) · 아키텍처: [../docs/architecture.md](../docs/architecture.md) · 판단 정책: [../docs/harness/POLICY.md](../docs/harness/POLICY.md)
>
> 이 파일은 backend 작업 시의 스택별 규칙만 다룹니다. 계약·완료 게이트·커밋 규칙은 정본을 따르세요.
> 명세·스켈레톤은 참고용([../docs/decisions/0003](../docs/decisions/0003-greenfield-redesign.md)) — 도메인은 강의 세션 중심으로 재설계.

## 스택·환경
- Spring Boot **2.7.18**, **Java 11**(JDK 17+면 Gradle 빌드 실패 — `JAVA_HOME` 확인), Gradle, Spring Security + JWT, JPA/Hibernate.
- DB: **PostgreSQL + pgvector**([../docs/decisions/0005](../docs/decisions/0005-db-postgres-pgvector.md)). 벡터 임베딩(자료·자막)도 이 DB.

## 컨트롤 플레인 책임 (LiveClass AI)
- 인증(JWT)·유저·**세션(live_session) CRUD**·자료(material_version) 관리.
- **LiveKit 토큰 발급 · Egress(HLS·녹화) 제어**([../docs/decisions/0004](../docs/decisions/0004-media-livekit-selfhost.md)).
- **Redis Streams 소비**: Python AI가 푸시한 자막·용어·근거·요약을 소비 → Postgres 영속 + WebSocket 전달([CONTRACT §3-1](../docs/CONTRACT.md#3-실시간서비스-간-계약-확정-인터페이스)).
- **채팅·자막 WebSocket** 소유(세션별 채널).
- **Q&A 프론트도어**(동기): 인증·정책·로깅 후 Python 호출, 응답을 **요청자에게만** 라우팅([CONTRACT §3-2](../docs/CONTRACT.md#3-실시간서비스-간-계약-확정-인터페이스)).

## 계약 준수 (BE가 지킬 것)
- **Response/Request 모델 필드명은 camelCase**([CONTRACT §1](../docs/CONTRACT.md#1-필드명-규칙--camelcase-통일)). DB 컬럼은 snake여도 DTO는 camel.
- **상태코드 규격**: 생성 201, 중복 409, 인증 실패 401, 권한 403([CONTRACT §2](../docs/CONTRACT.md#2-rest-api-apiv1)).
- Python↔Spring 브릿지 메시지·시간(세션 상대 ms)은 [CONTRACT §3](../docs/CONTRACT.md#3-실시간서비스-간-계약-확정-인터페이스) 준수.

## 패키지 구조
- REST 계층(controller/request/response/service)·도메인(entity/repository)·config·common을 스택 관례대로. 도메인은 **세션 중심**(공식 conference 계열 폐기, [../docs/decisions/0007](../docs/decisions/0007-domain-live-session.md)).

## 빌드·실행·테스트
```bash
cd backend
./gradlew clean build     # 빌드 (Windows: .\gradlew.bat)
./gradlew bootRun         # 실행 (HTTP 8080, Swagger)
./gradlew test            # 테스트
```

## 자물쇠 활성화 (필요 시)
계약 테스트 도입은 [../docs/harness/ENFORCEMENT.md](../docs/harness/ENFORCEMENT.md) 참고. 첫 계약 테스트 템플릿: `docs/harness/templates/ContractTestTemplate.java`.

> 구현 후속: `build.gradle`의 Kurento 의존성 제거 + LiveKit(server SDK)·Redis·Postgres 드라이버 추가는 CP 착수 시.
