-- 이미 처리된 수강 신청인데 "처리 대기"로 남아 있는 알림을 닫는다.
--
-- **왜 필요한가.** 처리 축을 닫는 코드가 없었다. 알림은 ACTION_REQUIRED로 생기기만 하고 승인·거절·
-- 취소 어느 쪽으로도 내려가지 않아서, 강사의 배지는 "처리 대기 1"인데 눌러 들어가면 승인 대기
-- 신청자가 없었다. 강사가 스스로 내릴 방법도 없었다 — 눌러도 아무 일이 일어나지 않으므로.
--
-- 코드는 이제 사건이 일어날 때 닫는다. 그건 **앞으로** 생길 알림에만 적용되므로 이미 쌓인 것은
-- 여기서 한 번 정리한다.
--
-- **완료와 만료를 구분한다.** 강사가 실제로 처리한 것(ACTIVE·REJECTED)은 COMPLETED이고, 학생이
-- 물러서 처리할 일 자체가 사라진 것(CANCELLED·REVOKED)은 EXPIRED다. 강사가 하지도 않은 일을
-- 했다고 기록하지 않는다.
--
-- **uuid로 캐스팅하지 않는다.** targets는 jsonb라 값이 uuid 형식이라는 보장이 없고, 한 줄이라도
-- 어긋나면 캐스팅이 예외를 내 마이그레이션이 통째로 실패한다 — 그러면 이 정리 때문에 앱이 뜨지
-- 않는다. 반대로 uuid를 text로 만드는 것은 언제나 안전하므로 그쪽으로 맞춘다.
UPDATE core.notification n
   SET action_status = CASE
                         WHEN e.status IN ('ACTIVE', 'REJECTED') THEN 'COMPLETED'
                         ELSE 'EXPIRED'
                       END,
       completed_at = now()
  FROM core.enrollment e
 WHERE n.type = 'ENROLLMENT_REQUESTED'
   AND n.action_status = 'ACTION_REQUIRED'
   AND e.id::text = n.targets ->> 'enrollmentId'
   AND e.status <> 'PENDING';

-- 수강 행이 아예 없는 알림(커리큘럼이 지워지면 수강 관계도 CASCADE로 함께 사라진다). 위 조인으로는
-- 닿지 않는다. 갈 곳이 없으니 만료다.
UPDATE core.notification n
   SET action_status = 'EXPIRED',
       completed_at = now()
 WHERE n.type = 'ENROLLMENT_REQUESTED'
   AND n.action_status = 'ACTION_REQUIRED'
   AND NOT EXISTS (
         SELECT 1 FROM core.enrollment e
          WHERE e.id::text = n.targets ->> 'enrollmentId');
