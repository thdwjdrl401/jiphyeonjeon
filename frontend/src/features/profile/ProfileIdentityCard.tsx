import type { Ref } from 'react'
import { USER_ROLE_LABEL, type AuthUser } from '@/features/auth/types'
import { StatusBadge } from '@/shared/ui/WorkspaceUi'
import ProfileAvatar from './ProfileAvatar'

interface ProfileIdentityCardProps {
  user: AuthUser
  /** "프로필 수정"을 누르면 부른다. 실제 수정 흐름(모달)은 페이지가 소유한다. */
  onEdit: () => void
  /** 모달을 닫은 뒤 포커스를 되돌리기 위해 페이지가 버튼을 잡는다. */
  editButtonRef?: Ref<HTMLButtonElement>
}

/**
 * 학생·강사가 함께 쓰는 계정 프로필 카드.
 *
 * 예전에는 "계정 정보"(이메일·가입 유형)와 "기본 프로필"(이미지·닉네임·이메일) 두 패널로 나뉘어
 * **이메일이 두 번 표시**되고, 한 계정의 정보가 두 카드로 흩어져 있었다. 하나로 합쳐 이메일을
 * 한 번만 보여 준다.
 *
 * <p>정보 위계는 익숙한 계정 화면(GitHub·Google 계정)을 따른다 — 이름이 가장 크고, 가입 유형과
 * 이메일은 그 아래 보조 정보로 붙고, 수정 액션은 오른쪽 끝에 둔다.
 *
 * <p><b>가입 유형과 이메일은 읽기 전용이다.</b> 그래서 입력 필드가 아니라 배지와 텍스트로 낸다 —
 * 테두리 있는 박스에 넣으면 눌러서 고칠 수 있는 것처럼 보인다. 수정 가능한 것은 프로필 이미지와
 * 닉네임뿐이고, 그 둘은 "프로필 수정" 한 곳으로만 들어간다.
 *
 * <p>레이블을 `dl`의 `dt`로 두고 화면에서는 감춘다: 배지에 "학생"이라고 쓰여 있고 이메일은 형태로
 * 알 수 있어 시각적으로는 레이블이 군더더기지만, 스크린리더에는 "가입 유형"·"가입 이메일"이라는
 * 이름이 필요하다.
 */
export default function ProfileIdentityCard({
  user, onEdit, editButtonRef,
}: ProfileIdentityCardProps) {
  return (
    <section className="profile-identity" aria-labelledby="profile-identity-name">
      <ProfileAvatar
        displayName={user.displayName}
        imageUrl={user.profileImageUrl}
        className="user-avatar--large"
      />
      <div className="profile-identity__info">
        <h2 className="profile-identity__name" id="profile-identity-name">{user.displayName}</h2>
        <dl className="profile-identity__meta">
          <div>
            <dt className="visually-hidden">가입 유형</dt>
            <dd>
              {/* 색만으로 학생·강사를 가르지 않는다 — 배지 안에 글자로도 들어 있다. */}
              <StatusBadge tone={user.role === 'INSTRUCTOR' ? 'warning' : 'success'}>
                {USER_ROLE_LABEL[user.role]}
              </StatusBadge>
            </dd>
          </div>
          <div>
            <dt className="visually-hidden">가입 이메일</dt>
            <dd className="profile-identity__email">{user.email}</dd>
          </div>
        </dl>
      </div>
      <button
        ref={editButtonRef}
        className="button button--primary button--small profile-identity__action"
        type="button"
        onClick={onEdit}
      >
        프로필 수정
      </button>
    </section>
  )
}
