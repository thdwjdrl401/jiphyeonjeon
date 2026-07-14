# ADR-0003: 명세·스켈레톤 참고용, 제로베이스 재설계

> 📍 하네스 개요: [../harness/README.md](../harness/README.md) · 아키텍처: [../ARCHITECTURE.md](../ARCHITECTURE.md)

- **상태**: 채택
- **일자**: 2026-07-14
- **관련**: LiveClass AI 전환. 파생 ADR: [0004](0004-media-livekit-selfhost.md)·[0005](0005-db-postgres-pgvector.md)·[0006](0006-backend-spring-plus-python-ai.md)·[0007](0007-domain-live-session.md)·[0008](0008-ai-bus-redis-streams-session-clock.md)

## 맥락
프로젝트가 공식 부트캠프 PJT(그룹 화상회의)에서 **LiveClass AI**(실시간 강의 + 자막 + RAG)로 피벗했다. 공식 명세·스켈레톤을 그대로 따르면 제품 기획과 맞지 않는다. 명세 자체도 필드명이 자기모순이고, 구현된 코드는 인증 도메인뿐이다.

## 결정
기존 PJT **명세서와 스켈레톤 코드는 참고용**으로만 사용한다. 본 기획에 맞춰 **구조 포함 제로베이스로 재설계**한다. "명세·스켈레톤대로 구현했는지"를 완료 기준으로 삼지 않는다.

## 근거
- 제품이 강의 플랫폼으로 바뀌어 공식 도메인(conference)과 불일치.
- 명세가 자기모순(필드명 snake/camel 혼용)이라 "그대로 준수"가 불가능.
- 코드가 거의 없어(auth만) 재설계 비용이 낮음.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **그린필드 재설계 (선택)** | 제품에 최적, 깔끔 | 공식 ERD/API와 달라짐 |
| 명세·스켈레톤 준수 유지 | 채점 호환 가정 | 제품 기획과 정면 불일치 |

## 영향·후속
- 도메인을 `live_session` 중심으로 재정의([0007](0007-domain-live-session.md)), 공식 conference 계열 폐기.
- [CONTRACT.md](../CONTRACT.md)에서 SPEC 파생 매핑 제거, camelCase는 **자체 컨벤션**으로 리프레이밍([0001](0001-field-name-camelcase.md)).
- AGENTS.md에 "명세·스켈레톤 참고용" 규칙 추가.
