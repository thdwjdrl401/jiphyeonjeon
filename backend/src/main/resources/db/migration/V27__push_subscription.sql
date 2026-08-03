-- Web Push 구독(ADR-0073 §9). 브라우저 하나 = 행 하나.
--
-- 표준 Web Push는 **벤더 계정 등록이 필요 없다**. 브라우저가 자기 푸시 서비스(Chrome은 FCM,
-- Firefox는 Mozilla autopush)에서 엔드포인트를 받아 오고, 우리는 VAPID 키쌍으로 "이 서버가
-- 보냈다"를 증명한다. 2016년까지 필요하던 FCM 발신자 ID를 VAPID가 대체했다.
CREATE TABLE core.push_subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  user_id uuid NOT NULL REFERENCES core.app_user(id) ON DELETE CASCADE,

  /*
   * 푸시 서비스가 준 주소. 이게 곧 기기 식별자다 — 같은 사람이 PC·폰·다른 브라우저를 쓰면
   * 행이 그만큼 생기고, 알림은 기기마다 따로 간다. PC에서 읽어도 폰 알림은 사라지지 않는다.
   */
  endpoint text NOT NULL,

  /*
   * 페이로드 암호화 키(RFC 8291). 서버는 이 둘로 본문을 암호화하고, 브라우저만 열 수 있다 —
   * 푸시 서비스는 내용을 보지 못한다. **비밀이므로 응답에 절대 내보내지 않는다.**
   */
  p256dh text NOT NULL,
  auth text NOT NULL,

  /** 브라우저·OS. 사용자가 "어느 기기인지" 알아보게 하려고 남긴다(설정 화면은 후속). */
  user_agent text,

  created_at timestamptz NOT NULL DEFAULT now(),
  /** 마지막으로 성공한 발송. 오래 조용한 구독을 정리할 때 본다. */
  last_success_at timestamptz,

  -- 같은 엔드포인트는 하나뿐이다. 재구독하면 새 행이 아니라 이 행을 갱신한다.
  UNIQUE (endpoint)
);

-- 발송은 언제나 "이 사람의 모든 기기"다.
CREATE INDEX idx_push_subscription_user ON core.push_subscription (user_id);

COMMENT ON TABLE core.push_subscription IS
  'Web Push 구독. 기기(브라우저)당 한 행이며 p256dh·auth는 비밀이라 응답에 나가지 않는다.';
