# ADR-0001: API 필드명을 camelCase로 통일

> 📍 하네스 개요: [../harness/README.md](../harness/README.md) · 계약 정본: [../CONTRACT.md](../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-08
- **관련**: Sub Ⅱ(방 CRUD), [ROADMAP.md](../ROADMAP.md) "🟡 최대 함정", [SPEC.md](../SPEC.md)

## 맥락
SPEC의 API JSON은 필드 표기가 **혼용**된다. 한 응답 객체 안에서 `joinUsersNum`·`callStartTime`(camel)과 `thumbnail_url`·`is_active`(snake)가 섞이고, 방 **생성 요청**은 `conferenceCategoryId`(camel)인데 **수정 요청**은 `conference_category`(snake)로 서로 다르다. SPEC 머리말이 밝혔듯 이는 OCR 오류가 아니라 **명세 자체의 계약 불일치**다. 방치하면 FE/BE가 서로 다른 필드명을 가정해 런타임에 `undefined`로 깨진다 — ROADMAP이 "최대 함정"으로 지목한 지점.

## 결정
**모든 API 요청/응답 필드명을 `camelCase`로 통일한다.** SPEC의 snake 표기는 구현에서 camelCase로 정정한다. 매핑 표는 [CONTRACT.md §1](../CONTRACT.md#1-필드명-규칙--camelcase-통일).

## 근거
- JS/Vue(FE)와 Java(BE) 양쪽 관례가 camelCase → 변환 레이어 불필요.
- SPEC이 이미 자기모순이므로 "명세 그대로"는 불가능 → 하나로 통일해야 함.
- 정적 규칙이라 **린트로 저비용 강제** 가능(테스트보다 값쌈). 판단 정책상 "린트로 충분" 케이스.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **camelCase 통일 (선택)** | FE/BE 관례 일치, 린트 강제 용이 | SPEC 표기와 다름(문서에 매핑 명시로 해소) |
| snake_case 통일 | DB 컬럼명과 일치 | JS/Java 관례 위배, FE 코드 이질적 |
| SPEC 그대로(혼용 유지) | 명세 충실 | 계약 불일치 그대로 → 함정 방치 |

## 영향·후속
- [CONTRACT.md](../CONTRACT.md)에 정정 매핑·주의 지점 반영(완료).
- **자물쇠**: Sub Ⅱ 착수 시 camelCase 린트 규칙 + 방 API 응답 계약 테스트 활성화([ENFORCEMENT.md](../harness/ENFORCEMENT.md)).
- BE Response/Request 모델, FE store/axios 매핑을 이 규칙으로 작성.
