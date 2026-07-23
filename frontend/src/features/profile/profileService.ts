import { selectDataSource } from '@/shared/api/dataSource'
import { httpProfileService } from './httpProfileService'
import { mockProfileService } from './mockProfileService'
import type { ProfileService } from './profileService.interface'

export const profileService = selectDataSource<ProfileService>(mockProfileService, httpProfileService)

export { httpProfileService } from './httpProfileService'
export { getProfileImageValidationError } from './profileValidation'
export type {
  ChangePasswordRequest,
  InstructorPublicProfile,
  ProfileService,
} from './profileService.interface'
