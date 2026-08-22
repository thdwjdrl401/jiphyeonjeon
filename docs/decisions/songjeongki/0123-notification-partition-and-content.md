# ADR-0123: 알림 본체는 달로 자르고, 문구는 사건당 한 번만 저장한다

> 관련 결정: [ADR-0073 알림 팬아웃 아키텍처](0073-notification-fanout-architecture.md)(§7의 문구 저장
> 결정을 일부 뒤집는다) · [공유 계약 §2-4 알림 센터](../../CONTRACT.md)

- **상태**: 일부 뒤집힘 — §A(문구 분리)는 유효하고, §B(월 파티셔닝)·§C(등록표 분리)는
  [ADR-0132](0132-notifications-are-not-deleted-so-the-table-is-not-partitioned.md)가 되돌렸다.
  알림을 지우지 않기로 하면서 파티션의 근거인 보존 정리가 사라졌다.
  원래 상태: 채택 — 구현됨 (V43·V44·V45, `NotificationPartitionMaintenance`)
- **일자**: 2026-08-13
- **적용 범위**: `core.notification`·`core.notification_content`·`core.notification_dedupe`,
  `notification` 모듈의 삽입 리포지토리 둘과 읽기 경로

## 한 줄 결정

`core.notification`을 **월 단위 파티션**으로 재생성하고, 문구를 **사건당 1행**
(`notification_content`)으로 뽑아내며, 파티셔닝과 충돌하는 전역 유니크(dedupe)는 **영구
등록표**(`notification_dedupe`)로 옮긴다.

## 맥락

fan-out on write(ADR-0073 §7)는 수신자별로 한 행을 만든다. 수강생 100만 커리큘럼이면 자료 게시
한 번에 100만 행이고, 그 행들이 지워지지 않고 쌓인다. 실측으로 행 ~590B 중 문구 네 컬럼
(title·message·targets·group_key)이 ~450B — **행의 4분의 3이 조각 전체 동일한 문자열**이다.
보존 정책이 생기면 "오래된 것 삭제"인데, 수백만 행 DELETE는 느리고 죽은 튜플과 인덱스 팽창을
남긴다.

### 0073 §7은 왜 그때 맞았고 지금 무엇이 바뀌나

§7의 "문구는 만들 때 완성해 저장한다"는 두 문장이 근거였다: ① 알림은 그때 일어난 일의 기록이다,
② 목록 조회가 단일 테이블 읽기가 된다(60초 폴링). ①은 **그대로 지킨다** — 문구는 여전히 만들 때
완성해 굳히고, 위치만 사건당 1행으로 옮긴다. ②는 절반만 옳았다: 60초마다 오는 것은 목록이 아니라
**배지 개수**이고, 개수 쿼리는 문구를 읽지 않는다. 목록이 지불하는 것은 PK 조인 하나뿐이다.
그때는 이 구분 없이 "단일 테이블"을 통째로 지켰고, 규모 산정(수강생 수백)에서는 그 값이 0이었다.
100만을 목표로 하는 지금은 같은 문자열 100만 벌이 값이다.

## 결정

### A. 문구는 사건당 1행 — `notification_content`

`type·severity·title·message·targets·group_key·previous/next_starts_at`을 content로 옮기고 본체는
`content_id`로 가리킨다. 수신자별 행에는 정말 사람마다 다른 값(수신자, 두 상태 축, 시각들)만 남는다.

- **content 행 재사용은 결정적 id로 한다.** 커서로 나뉜 조각들이 같은 사건이면 같은 content에
  도달해야 하는데, 두 방법을 검토했다 — content_id를 커서 메시지에 실어 나르기 vs 사건 식별자에서
  id를 파생하기. **파생을 골랐다**: 이미 모든 삽입이 사건 식별자(dedupe 접두사/키)를 들고 다니므로
  메시지 스키마를 바꿀 필요가 없고, 첫 조각이 재배달돼도 같은 id에 부딪혀(`ON CONFLICT DO NOTHING`)
  고아 content가 생기지 않는다. 실어 나르기는 첫 조각 재배달마다 content가 하나씩 새로 생긴다.
- **좁은 팬아웃도 같은 구조다.** 수강 사건 문구에는 학생 이름이 들어가 content가 수신자당 1행이
  된다. 그래도 경로를 가르지 않는다 — dedupe 키에 수신자가 이미 들어 있어 파생 id가 저절로
  갈라지고, 저장이 조금 덜 절약되는 값이 경로 두 벌 유지비보다 싸다.
- **읽기 경로**는 JPA `@ManyToOne`(EAGER) + 목록 쿼리의 fetch join. 엔티티가 문구 접근자를
  content로 위임해 응답 조립·대상 재판정 코드는 한 줄도 바뀌지 않았다. **배지 개수 쿼리는
  건드리지 않았다** — content와 무관하다.

### B. 월 파티셔닝

`PARTITION BY RANGE (created_at)`, 월 단위. 보존 정리가 DELETE가 아니라 **파티션 DROP**(파일
삭제, 수 ms)이 된다.

- PK는 파티션 키를 포함해야 하므로 `(id, created_at)`. 기존 조회(`WHERE id=? AND recipient_id=?`)는
  파티션 키 조건이 없어 **전 파티션의 PK 인덱스를 하나씩 찔러 본다**. 보존 12 + 선생성 3 =
  수십 개 수준이라 감수한다 — 단건 조회는 사용자가 알림을 누를 때뿐이다.
- 인덱스 세 벌(recipient+created_at, unread 부분, action_required 부분)은 파티션드 인덱스로 유지.
- **선생성 잡**(`NotificationPartitionMaintenance`, 매일 새벽 + 기동 직후): 앞으로 3개월치를
  `CREATE TABLE IF NOT EXISTS … PARTITION OF`로 만든다. 멱등이고, 실패해도 다음 달 생성을 계속
  시도하는 관대한 잡이다. `DEFAULT` 파티션을 예비로 두어 선생성이 멈춰도 INSERT가 죽지 않고,
  거기에 행이 있으면 매일 WARN을 남긴다.
- **보존 DROP 잡**: `notification.retention.months`(기본 12)를 지난 달의 파티션을 DROP.
  **보존 정책 자체는 미확정이다** — 기본값을 보수적으로 두고 설정으로 조절한다. 어느 파티션이
  어느 달인지는 이름(`notification_pYYYY_MM`)에서 읽는다 — 파티션은 전부 우리 코드가 이 규칙으로
  만들고, 규칙 밖 이름(수동 개입 흔적)은 건드리지 않는 안전판을 겸한다.

### C. dedupe는 전역 등록표 — 파티셔닝과 전역 유니크의 충돌 해소

파티션 테이블에는 파티션 키 없는 전역 유니크를 걸 수 없다. `dedupe_key` 유니크를
`(dedupe_key, created_at)`으로 바꾸면 "달이 바뀌면 같은 사건을 다시 알린다"가 되는데, dedupe는
월을 넘어야 한다 — 다시보기를 철회했다 몇 달 뒤 재공개해도 다시 알리지 않는다
(`RecordingNotificationContractTest`).

- `notification_dedupe(dedupe_hash uuid PK, created_at)` — **파티셔닝하지 않고 영구**. 원문
  varchar(300) 대신 `md5(dedupe_key)::uuid`(16B)만 담는다. 등록표는 "본 적 있는가"만 답하면 되고,
  행이 작아야 인덱스가 메모리에 오래 남는다. md5 충돌은 2⁻⁶⁴ 규모라 무시한다.
- 팬아웃 CTE 확장: `slice` → **등록표에 ON CONFLICT DO NOTHING, RETURNING이 통과자** → 통과자만
  본체 INSERT. 한 문장·같은 트랜잭션 그대로다.
- **불변식은 그대로다**: 커서와 훑은 수는 여전히 `slice`에서 나온다. 등록표가 조각 전체를
  걸러내도(`inserted=0`) `scanned`가 조각 크기와 같으면 체인이 이어진다 —
  `NotificationWideFanoutContractTest`의 "전부 중복인 조각에서도 체인이 이어짐"이 잠근다.
- 좁은 팬아웃(`NotificationInsertRepository`)도 같은 등록표를 지나는 같은 모양의 CTE다.

### D. fillfactor 90 — 과장 없이

본체 파티션에 `fillfactor=90`. **HOT을 기대해서가 아니다** — read_status·action_status는 부분
인덱스 술어에 걸린 컬럼이라 그 갱신은 HOT이 될 수 없다(술어 컬럼 변경은 인덱스 갱신을 요구한다).
남는 효과는 갱신으로 생기는 새 버전이 같은 페이지에 들어갈 여지, 즉 **페이지 분할 완화** 정도다.
읽기 위주 표에서 10% 공간을 내주는 값이며, 효과가 미미하면 되돌릴 수 있는 파라미터다.

### E. 기존 데이터 이행

Flyway가 부팅 시 돈다(core는 백엔드 부팅이 곧 마이그레이션). 세 단계 각각이 한 트랜잭션이다.

1. **V43**: content 생성 + 동일 문구 그룹핑 백필(여덟 컬럼이 전부 같은 행 = 한 사건) +
   `content_id NOT NULL`. 채우지 못한 행이 있으면 NOT NULL이 실패해 통째로 롤백된다.
2. **V44**: 등록표 생성 + 기존 `dedupe_key` 해시 백필.
3. **V45**: 파티션드 본체 생성(기존 데이터의 첫 달~now+3개월 + DEFAULT) → 복사 → DROP → 이름
   스왑. 같은 트랜잭션이라 밖에서 표가 없는 순간이 보이지 않는다. 옛 문구 컬럼은 컬럼 DROP이
   아니라 표 재생성으로 사라진다 — 죽은 공간이 남지 않는다.

## 채택하지 않은 대안

### 1. content_id를 커서 메시지에 실어 나른다

첫 조각이 content를 만들고 다음 조각 메시지에 id를 싣는 안. 메시지 스키마가 늘고, 첫 조각
재배달(릴레이 재발행·미ack 재배달은 정상 경로다)마다 고아 content가 하나씩 생긴다. 결정적 id
파생은 두 문제가 모두 없고 코드가 리포지토리 안에 갇힌다.

### 2. dedupe 등록표 대신 "본체 삽입 전 SELECT로 확인"

전역 인덱스가 없어도 SELECT+INSERT로 흉내 낼 수 있지만, 동시 재배달 두 건이 같은 SELECT를
통과하면 둘 다 넣는다 — V23 주석이 못 박은 "중복 방지를 애플리케이션에 맡기지 않는다"로 되돌아
가는 것이다. 등록표의 PK 충돌은 DB가 직렬화한다.

### 3. 해시 대신 dedupe_key 원문을 등록표에 저장

디버깅이 쉽다(지문이 사람이 읽는 문자열). 그러나 평균 ~70B 원문 vs 16B 해시는 등록표가 영구로
쌓이는 표라는 점에서 차이가 계속 벌어지고, 원문이 필요한 조회 경로가 없다. 원문 구성 규칙은
코드에 있으므로 사건에서 재계산해 조회할 수 있다.

### 4. 파티셔닝 없이 content 정규화만

행이 68B로 줄어 DELETE 부담도 준다. 그러나 100만 행 DELETE는 여전히 인덱스 4벌을 두드리고
VACUUM 뒤에나 공간이 돌아온다. 파티션 DROP은 이 문제 자체가 없고, 어차피 표를 재생성해야
문구 컬럼의 죽은 공간이 사라지므로 같은 마이그레이션 창에 함께 하는 값이 가장 싸다.

## 결과와 한계

### 실측 (PG16, 10사건 × 10,000명 = 100,000행, 운영 규모 한국어 문구)

| | 이전(V23 모양) | 이후 |
|---|---|---|
| 대표 행 payload 합(`pg_column_size`) | **~590B** (문구 4컬럼 ~450B) | 본체 **68B** + 등록표 24B + content 500B/사건 |
| 표 크기·인덱스 포함(100k행) | **84 MB** | **34 MB** (본체 25 + 등록표 9.5 + content 0.06) |
| 힙만 | 60 MB | 11 MB |

수신자가 늘수록 content 몫은 상수라 격차는 더 벌어진다. 남은 부피의 상당분은 등록표(행당 인덱스
포함 ~97B)다 — 영구 보존의 값이다.

### 한계

- **단건 조회가 전 파티션 인덱스를 찌른다**(§B). 파티션 수십 개 전제이며, 보존 개월을 크게
  늘리면 이 비용도 는다.
- **고아 content가 남는다.** 파티션 DROP은 본체만 지우므로 그 달 사건의 content 행은 참조 없이
  남는다(FK 때문에 먼저 지울 수도 없다). 사건당 1행·~500B라 12개월치가 수 MB 규모다. 커지면
  보존 잡에 anti-join 정리를 더한다 — 그때는 `content_id` 인덱스가 필요할 수 있다.
- **등록표는 영원히 자란다.** 행당 ~100B × 누적 수신 건수. dedupe가 시간을 넘는 대가이며,
  "몇 년 지난 지문은 지워도 되는가"는 보존 정책과 함께 정할 일이다.
- 파티션 경계는 서버 시간대(UTC) 달 경계다. "8월분"이 KST 기준과 9시간 어긋나지만, DROP 단위가
  달이면 충분한 용도라 감수한다.
- 파티션 관리 잡도 **단일 인스턴스 전제**다(LiveStartingSoonScheduler와 같은 전제). IF NOT
  EXISTS라 깨지지는 않지만 늘리면 DDL 잠금 경합이 생긴다.
- fillfactor 90은 페이지 분할 완화가 전부다(§D). 부분 인덱스 술어 컬럼 갱신은 HOT이 안 된다.

## 검증

- `NotificationReadContractTest` — 응답 모양·두 축·개수·404가 정규화 뒤에도 그대로다(응답은
  한 글자도 바뀌지 않았다).
- `NotificationWideFanoutContractTest` — 커서 슬라이싱 불변식: 조건에 맞는 사람에게만, 건너뜀·겹침
  없음, **전부 중복인 조각에서도 체인이 이어짐**(등록표가 걸러도 scanned가 답한다).
- `NotificationFanoutContractTest`·`RecordingNotificationContractTest`·
  `LiveScheduleNotificationContractTest`·`LiveStartingSoonContractTest` — dedupe 의미(재신청은 다시,
  재공개는 조용히)가 등록표로 옮긴 뒤에도 같다.
- `NotificationPartitionMaintenanceTest` — 선생성 멱등, 범위 밖 행이 `DEFAULT` 파티션에 잡히고 잡이 보고,
  **파티션을 DROP해도 같은 사건이 다시 알리지 않음**(등록표 생존), 보존 기간 안 파티션은 무사.
- `StaleEnrollmentNotificationBackfillTest` — V35는 번호순 덕에 언제나 V45 이전 모양 위에서
  돈다는 사실을 테스트가 그 모양을 재현해 그대로 잠근다.
- 백엔드 전체 스위트 통과(아래 MR 설명의 수치).
