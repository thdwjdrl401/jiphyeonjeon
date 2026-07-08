# AGENTS.md — Backend (Spring Boot)

> 📍 정본 규칙: [../AGENTS.md](../AGENTS.md) · 공유 계약: [../docs/CONTRACT.md](../docs/CONTRACT.md) · 판단 정책: [../docs/harness/POLICY.md](../docs/harness/POLICY.md)
>
> 이 파일은 backend 작업 시의 스택별 규칙만 다룹니다. 계약·완료 게이트·커밋 규칙은 정본을 따르세요.

## 스택·환경
- Spring Boot **2.7.18**, **Java 11**(JDK 17+면 Gradle 빌드 실패 — `JAVA_HOME` 확인), Gradle 6.9.4, QueryDSL 4.4, Spring Security + JWT.
- DB: MySQL 8.0 `liveclass_web_db`. 커넥션풀 HikariCP.

## 패키지 구조 (`com.liveclass`)
```
api/controller  · api/request · api/response · api/service   ← REST 계층 (요청/응답 모델 분리)
common/auth · common/exception · common/model/response · common/util
config          ← 보안·Swagger 등 설정
db/entity · db/repository   ← JPA 엔티티 · Repository + RepositorySupport(QueryDSL)
```
- API prefix `/api/v1`. Controller는 카테고리별 파일 분리. 각 엔드포인트에 Swagger 어노테이션.
- Service/Impl 분리(DB 접근·트랜잭션·가공은 Service).

## 계약 준수 (BE가 지킬 것)
- **Response/Request 모델 필드명은 camelCase**([CONTRACT §1](../docs/CONTRACT.md#1-필드명-규칙--camelcase-통일)). DB 컬럼은 snake여도 DTO는 camel.
- **상태코드 규격** 준수: 회원가입 201, 중복확인 409, 로그인 실패 401/404 등([CONTRACT §2](../docs/CONTRACT.md#2-api-상태코드응답-규격)).

## 빌드·실행·테스트
```bash
cd backend
./gradlew clean build     # 빌드 (Windows: .\gradlew.bat)
./gradlew bootRun         # 실행 (HTTP 8080, Swagger: /swagger-ui/index.html)
./gradlew test            # 테스트 (test 소스셋은 아직 없음 — 첫 계약 테스트로 생성)
```
- 루트에서 FE+BE 동시: `npm run dev` (레포 루트).

## 자물쇠 활성화 (필요 시)
계약 테스트·Checkstyle 도입은 [../docs/harness/ENFORCEMENT.md](../docs/harness/ENFORCEMENT.md)의 가이드·템플릿을 따른다. 첫 계약 테스트 템플릿: `docs/harness/templates/ContractTestTemplate.java`.
