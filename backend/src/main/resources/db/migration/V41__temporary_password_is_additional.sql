-- 임시 비밀번호를 기존 비밀번호를 <b>덮어쓰지 않고 따로</b> 둔다.
--
-- V40은 password_hash를 임시 값으로 갈아끼우고 must_change_password를 세웠다. 그러면 남이 내
-- 이메일로 재발급을 누르기만 해도 내가 로그인에서 튕긴다 — 메일함을 못 봐도 남의 계정을 잠글 수
-- 있는 셈이라, 막으려던 것보다 나쁜 성질이 생긴다.
--
-- 임시 비밀번호를 열쇠 하나 더로 두면 그 공격이 사라진다. 기존 비밀번호는 계속 유효하고,
-- 임시 비밀번호는 30분 뒤 만료되거나 새 비밀번호를 정하는 순간 폐기된다.
ALTER TABLE core.app_user
  ADD COLUMN temporary_password_hash varchar(100),
  ADD COLUMN temporary_password_expires_at timestamptz;

COMMENT ON COLUMN core.app_user.temporary_password_hash IS
  '메일로 보낸 임시 비밀번호의 해시. password_hash와 별개로 살아 있으며 폐기 시 NULL.';
COMMENT ON COLUMN core.app_user.temporary_password_expires_at IS
  '임시 비밀번호 만료 시각. 지나면 그 값으로는 로그인할 수 없다.';

-- must_change_password는 <b>계정의 성질이 아니라 이번 로그인의 성질</b>이다. 임시 비밀번호로
-- 들어왔는지 아닌지는 세션이 알아야 하고(원래 비밀번호로 들어온 사람은 바꿀 이유가 없다),
-- 계정 행에 두면 원래 비밀번호로 들어온 사람까지 변경 화면에 갇힌다.
ALTER TABLE core.app_user
  DROP COLUMN must_change_password;
