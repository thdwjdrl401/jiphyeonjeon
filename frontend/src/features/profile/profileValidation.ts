const MAX_PROFILE_IMAGE_SIZE = 5 * 1024 * 1024
const ALLOWED_PROFILE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function getProfileImageValidationError(file: File) {
  if (!ALLOWED_PROFILE_IMAGE_TYPES.has(file.type)) {
    return 'JPG, PNG, WEBP 이미지만 등록할 수 있습니다.'
  }
  if (file.size <= 0) return '비어 있는 파일은 등록할 수 없습니다.'
  if (file.size > MAX_PROFILE_IMAGE_SIZE) return '프로필 이미지는 5MB 이하여야 합니다.'
  return null
}
