# ADR-0077: 자료 무결성 — 백엔드 계약 요청 정리

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)
>
> **이 문서는 프론트엔드가 단독으로 닫을 수 없는 구멍만 모았다.** FE 안에서 해결되는 항목(자료 동기화
> 순서, 부분 성공 반영, 저장 중 추가분 보존)은 이 ADR의 대상이 아니라 후속 커밋에서 바로 고친다.

- **상태**: 제안 (백엔드 파트 협의 대기)
- **일자**: 2026-08-04
- **관련**: Sub Ⅱ, [ADR-0075](0075-autosave-syncs-query-cache.md), [ADR-0076](0076-thumbnail-instant-save-and-lesson-cache.md),
  ADR-0035(레슨 자료 연결), ADR-0042(커리큘럼 자료), songjeongki/0023(presigned 업로드)

## 맥락 (Context)

자료 업로드·서버 상태 변경 경로를 UI → FE 상태 → API → 서비스 → DB → 스토리지까지 훑었다. 현재
중복·무결성 방어의 실제 상태는 이렇다.

| 계층 | 있는 것 | 없는 것 |
|---|---|---|
| FE | 디바운스, 재진입 가드(`savingRef`), `fileName+fileSize` 완전일치 중복 차단 | 파일명 정규화, 생성 이중 제출 이른 return |
| API | CSRF 단일 캐시, 뮤테이션 자동 재시도 없음 | 멱등 키 |
| BE | attach 사전 조회 → 409, `saveAndFlush` + `DataIntegrityViolationException` → 409, detach 멱등, `complete` 멱등, 상태 전이 검사(publish/archive/delete 409) | **파일명 기준 중복 검증**, **생성 멱등성** |
| DB | 부분 유니크 `uq_material_active(lesson_id, asset_id) WHERE ACTIVE`(V5), `uq_curriculum_material_active(curriculum_id, asset_id) WHERE ACTIVE`(V8), 스코프 배타 CHECK | **(스코프, 파일명) 유니크** |
| 스토리지 | `AssetReaper`가 만료 PENDING 회수 | **UPLOADED-미연결/연결 해제된 객체 정리** |

**핵심 진단: 서버·DB의 중복 판단 기준은 `asset_id` 하나뿐이다.** 그런데 업로드마다 새 asset 행(새
`object_key`)이 생기므로, 같은 파일을 다시 올려 붙이면 `asset_id`가 달라 두 유니크 인덱스가 모두
통과한다. 즉 서버가 막는 것은 "이미 연결된 자료를 같은 assetId로 다시 붙이기"뿐이고, **"같은 파일을
다시 올려 붙이기"를 막는 것은 프론트엔드의 `fileName+fileSize` 비교가 유일**하다. `asset.checksum`
컬럼은 존재하지만 채워지지 않는다(V1 주석: "내용 중복 dedup은 MVP 미적용").

## 결정 (Decision)

아래 네 건을 백엔드 계약 변경 요청으로 제출한다. 계약이 오기 전까지 FE는 현재의 1차 방어(로컬
`fileName+fileSize` 비교, `disabled` + 이른 return)를 유지하되, **그것으로 무결성이 보장된다고 적지 않는다.**

### 요청 1 — 자료 파일명 중복을 서버·DB에서 막는다 (우선순위: 높음)

- **API**: `POST /api/instructor/curriculums/{id}/materials`, `POST /api/instructor/lessons/{id}/materials`
- **동작**: 같은 스코프의 `status='ACTIVE'` 자료 중 **정규화 파일명**이 같은 것이 있으면 거절.
- **정규화 규칙(제안)**: `trim` → 유니코드 `NFC` → 소문자화(`toLowerCase(Locale.ROOT)`) → 연속 공백 1칸.
  맥에서 만든 한글 파일명(NFD)과 윈도(NFC)가 같은 파일로 취급되어야 한다.
- **응답**: 409 + 기존 코드 재사용(`MATERIAL_ALREADY_ATTACHED`) 또는 신설 `MATERIAL_FILENAME_DUPLICATED`.
  FE가 "이미 같은 이름의 자료가 있습니다"로 안내하려면 **어느 파일명이 걸렸는지** 메시지에 필요하다.
- **DB**: `material_asset`에 `normalized_file_name` 컬럼(생성 시 애플리케이션이 채움)을 추가하고
  부분 유니크 인덱스 2개를 건다 — `(lesson_id, normalized_file_name) WHERE status='ACTIVE'`,
  `(curriculum_id, normalized_file_name) WHERE status='ACTIVE'`. 사전 조회만으로는 동시 요청 레이스가
  남으므로(V5·V8을 둔 것과 같은 이유) 인덱스가 최종 방어선이어야 한다.
- **주의**: 파일명은 지금 `asset.original_filename`에만 있고 `material_asset`에는 없다. 조인으로는
  유니크 인덱스를 걸 수 없으므로 **컬럼 비정규화가 필요하다**. 기존 행 백필 시 이미 중복인 데이터가
  있으면 인덱스 생성이 실패하므로, 마이그레이션은 중복 탐지 → 최신 1건만 ACTIVE 유지 순서가 필요하다.

### 요청 2 — 커리큘럼 초안 생성 멱등성 (우선순위: 높음)

- **API**: `POST /api/instructor/curriculums`
- **문제**: 지금은 호출마다 새 행이 생기고 서버에 중복 감지가 없다. FE의 `disabled`가 유일한 방어이며,
  응답만 유실되고 서버는 성공한 경우 사용자가 재시도하면 **동일 초안 2개**가 남는다(수동 삭제만 가능).
- **제안(택 1)**:
  - (a) `Idempotency-Key` 헤더 — FE가 UUID를 만들어 보내고, 서버가 (강사, 키)로 24시간 저장해 같은 키면
    **최초 결과를 그대로 재응답**(201 대신 200도 가능). 재시도 안전성이 가장 확실하다.
  - (b) 짧은 창(예: 10초) 안의 (강사, 제목) 동일 요청은 기존 초안을 재사용하고 200으로 응답.
    구현은 싸지만 "일부러 같은 제목의 초안 2개"를 못 만든다.
- FE는 (a)를 선호한다 — 생성 화면이 만든 키를 재시도에 그대로 쓰면 되고, 다른 생성 API에도 같은 방식을
  확장할 수 있다.

### 요청 3 — 고아 에셋·객체 정리 확장 (우선순위: 중간)

- **현재**: `AssetReaper.reapExpiredPendingAssets()`는 `status=PENDING`만 회수한다.
- **비는 경우**:
  - `complete`까지 성공했지만 attach 전에 실패·이탈한 asset → `UPLOADED`인데 아무도 참조하지 않음.
  - `detach`로 연결이 끊긴 자료의 asset → `material_asset.status='DELETED'`, asset은 `UPLOADED` 유지,
    스토리지 객체도 남음. 삭제 경로 어디에도 `storage.delete` 호출이 없다.
- **제안**: 참조 없는 `UPLOADED` 에셋(자료 연결 없음 + `curriculum.thumbnail_asset_id` 미참조 +
  `app_user` 프로필 이미지 미참조)이 N시간(예: 24h) 이상 지나면 객체 삭제 + `DELETED` 전이.
  판정은 asset 모듈이 다른 모듈 테이블을 직접 보지 않도록 **참조 조회 포트**로 뒤집는 편이 모듈 경계에 맞는다.
- **보존 정책 질문**: 강사가 실수로 지운 자료를 되살리는 요구가 있는지에 따라 유예 기간이 달라진다.

### 요청 4 — 자료 동기화를 단일 엔드포인트로 (우선순위: 중간, 구조 개선)

- **현재**: FE가 저장 한 번에 5~8개 HTTP를 순차로 던진다(기본 정보 PATCH → 섹션 PATCH/POST → 순서 PUT →
  자료 목록 GET → 사라진 자료 DELETE → 새 자료 attach → 목록 GET). 서버는 각 호출만 원자적이라
  **중간에서 끊기면 부분 반영**이 남고, 두 탭이 겹치면 한쪽이 다른 쪽 자료를 지울 수 있다
  (자료 동기화는 `structure_version` CAS 보호 밖이다).
- **제안**: `PUT /api/instructor/curriculums/{id}/materials` — 본문에 **목표 상태**(유지할 materialId
  목록 + 새로 붙일 assetId 목록)를 싣고 서버가 한 트랜잭션에서 diff·적용. 낙관적 동시성 토큰을 함께
  받으면(예: `materialsVersion` 또는 기존 `structureVersion` 재사용) 다중 탭 유실도 감지할 수 있다.
- FE는 이 계약이 오면 자료 동기화 코드를 이 호출 하나로 대체한다. 그때 요청 1의 파일명 검증도 이
  엔드포인트에서 한 번에 판정되어 부분 실패 경로가 크게 줄어든다.

### 요청 5 — 대표 이미지 비우기 (ADR-0076 후속, 우선순위: 낮음)

`PATCH`의 `thumbnailAssetId`가 null을 "변경 안 함"으로 쓰고 있어 삭제를 표현할 수 없다. 명시적 플래그
(`clearThumbnail: true`) 또는 `DELETE /api/instructor/curriculums/{id}/thumbnail`이 필요하다. 현재
FE는 삭제 버튼 자리를 비활성으로 두고 이유를 표시한다.

## 근거 (Rationale)

- **UI Disabled·디바운싱은 1차 방어일 뿐**이라는 원칙을 그대로 적용했다. 요청 1·2는 FE에서 아무리 잘
  막아도 API를 직접 호출하거나 응답이 유실되면 무너지는 항목이라 서버·DB가 최종 판정을 해야 한다.
- 요청 1을 DB 인덱스까지 끌고 가는 이유는 이 프로젝트가 이미 그 패턴을 두 번 택했기 때문이다
  (V5·V8). 사전 조회 + `DataIntegrityViolationException` 변환은 이미 검증된 코드 경로다.
- 요청 3·4는 무결성보다 "쌓이는 쓰레기"와 "부분 반영 창"의 문제라 우선순위를 낮췄다. 다만 요청 4가
  들어오면 FE의 부분 실패 경로 대부분이 사라지므로, 장기적으로는 가장 값이 큰 변경이다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| (선택) 서버·DB 파일명 검증 | 우회 불가, 동시 요청까지 차단 | 컬럼 추가 + 기존 중복 백필 마이그레이션 필요 |
| FE 정규화 비교만 강화 | 백엔드 변경 없음 | API 직접 호출·다중 탭·응답 유실에 무력 |
| 내용 해시(checksum)로 판정 | "같은 내용" 정확 판정 | 업로드 전 해시 계산 비용, 이름만 다른 같은 파일을 막을지에 대한 정책 결정 필요 |
| (선택) `Idempotency-Key` | 재시도 안전, 다른 API로 확장 | 키 저장소(테이블 또는 캐시) 필요 |
| 창 기반 중복 감지 | 구현 싸다 | 의도적 동일 제목 생성을 막는다 |

## 영향·후속 (Consequences)

- 이 ADR은 **제안 상태**다. 백엔드 파트 합의 후 상태를 채택으로 바꾸고, 확정된 필드명·상태코드는
  [CONTRACT](../../CONTRACT.md)에 반영한다(요청 1의 409 코드, 요청 2의 헤더, 요청 4의 요청·응답 형태).
- 계약이 오기 전 FE가 먼저 닫는 구멍(이 ADR 범위 밖, 후속 커밋):
  1. 자료 동기화 순서 역전 — attach를 먼저, DELETE를 마지막에. 중단돼도 기존 자료가 살아남는다.
  2. 부분 실패 시 성공한 attach를 로컬에 반영 — 재시도가 이미 올라간 파일을 지우고 다시 올리는
     루프(고아 파일 누적)를 끊는다.
  3. 저장 중 추가한 선택 보존 — 완료 응답이 로컬 목록을 통째로 덮어 방금 고른 파일이 사라지는 문제.
- 위 세 건을 고쳐도 **같은 파일명 중복 등록과 초안 중복 생성은 남는다**. 요청 1·2 없이는 닫히지 않으므로,
  이 ADR이 그 사실을 기록으로 남긴다.
