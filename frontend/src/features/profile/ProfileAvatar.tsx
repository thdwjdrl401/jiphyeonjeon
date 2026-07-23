interface ProfileAvatarProps {
  displayName: string
  imageUrl?: string | null
  className?: string
  decorative?: boolean
}

export default function ProfileAvatar({
  displayName,
  imageUrl,
  className = '',
  decorative = false,
}: ProfileAvatarProps) {
  const label = `${displayName} 프로필 이미지`

  return (
    <span
      className={`user-avatar ${className}`.trim()}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative || undefined}
    >
      {imageUrl
        ? <img alt="" src={imageUrl} />
        : displayName.trim().slice(0, 1) || '?'}
    </span>
  )
}
