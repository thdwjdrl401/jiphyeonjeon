-- 임시 비밀번호로 로그인한 사용자를 비밀번호 변경 전까지 붙잡아 두는 표시.
--
-- 임시 비밀번호는 평문으로 메일함에 남는다. 만료만 걸고 두면 그 메일이 살아 있는 한 계정도 열려
-- 있는 셈이라, 첫 로그인에서 반드시 바꾸게 한다.
--
-- 기존 사용자는 임시 비밀번호를 받은 적이 없으므로 false로 승계한다 — true로 두면 전원이
-- 비밀번호 변경 화면에 갇힌다.
ALTER TABLE core.app_user
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN core.app_user.must_change_password IS
  '임시 비밀번호 발급 후 아직 바꾸지 않았는가. true면 비밀번호 변경 외의 화면을 막는다.';
