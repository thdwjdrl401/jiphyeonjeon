import { ApiError } from '@/shared/api/client'
import type {
  RecordedCaptionStatus,
  RecordedProcessingStatus,
  RecordedProcessingView,
} from './recordedLessonService.interface'

const ACTIVE_PROCESSING_STATUSES = new Set<RecordedProcessingStatus>([
  'QUEUED',
  'TRANSCODING',
  'VERIFYING',
])

export const RECORDED_PROCESSING_POLL_INTERVAL_MS = 3_000

const ACTIVE_CAPTION_STATUSES = new Set<RecordedCaptionStatus>(['PENDING', 'PROCESSING'])

export function recordedProcessingPollInterval(processing?: RecordedProcessingView) {
  return processing
    && processing.recordedPublicationStatus === 'DRAFT'
    && processing.status !== 'FAILED'
    && processing.captionStatus !== 'FAILED'
    && (ACTIVE_PROCESSING_STATUSES.has(processing.status)
      || ACTIVE_CAPTION_STATUSES.has(processing.captionStatus))
    ? RECORDED_PROCESSING_POLL_INTERVAL_MS
    : false
}

export interface RecordedProcessingStage {
  status: Exclude<RecordedProcessingStatus, 'AWAITING_UPLOAD' | 'FAILED'>
  title: string
  description: string
}

export const RECORDED_PROCESSING_STAGES: RecordedProcessingStage[] = [
  {
    status: 'QUEUED',
    title: '변환 대기',
    description: '영상을 재생용 형식으로 변환할 준비를 하고 있습니다.',
  },
  {
    status: 'TRANSCODING',
    title: 'HLS 변환',
    description: 'MP4 영상을 재생용 HLS로 변환하고 있습니다.',
  },
  {
    status: 'VERIFYING',
    title: '재생 검증',
    description: '변환된 영상과 재생 목록을 확인하고 있습니다.',
  },
  {
    status: 'READY',
    title: 'HLS 준비 완료',
    description: '영상 재생본이 준비됐으며 AI 자막 완료를 함께 기다립니다.',
  },
]

export function recordedProcessingStageIndex(status: RecordedProcessingStatus) {
  return RECORDED_PROCESSING_STAGES.findIndex((stage) => stage.status === status)
}

const FAILURE_MESSAGES: Record<string, string> = {
  SOURCE_DOWNLOAD_FAILED: '원본 영상을 불러오지 못했습니다.',
  SOURCE_INVALID: '재생할 수 있는 MP4 영상인지 확인하지 못했습니다.',
  FFPROBE_FAILED: '재생할 수 있는 MP4 영상인지 확인하지 못했습니다.',
  SOURCE_TOO_LARGE: '허용된 영상 크기를 초과했습니다.',
  DURATION_LIMIT_EXCEEDED: '허용된 영상 길이를 초과했습니다.',
  FFMPEG_FAILED: '영상을 HLS로 변환하지 못했습니다.',
  OUTPUT_UPLOAD_FAILED: '변환된 영상을 저장하지 못했습니다.',
  MANIFEST_MISSING: '변환 결과의 재생 목록을 확인하지 못했습니다.',
  MANIFEST_INVALID: '변환 결과의 재생 목록을 확인하지 못했습니다.',
  DISPATCH_FAILED: '영상 처리 중 일시적인 문제가 발생했습니다.',
  SOURCE_NOT_READY: '영상 처리 중 일시적인 문제가 발생했습니다.',
  WORKER_INTERNAL_ERROR: '영상 처리 중 일시적인 문제가 발생했습니다.',
}

export function recordedProcessingFailureMessage(failureCode: string | null) {
  if (!failureCode) return '영상 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'
  return FAILURE_MESSAGES[failureCode]
    ?? '영상 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.'
}

const CAPTION_FAILURE_MESSAGES: Record<string, string> = {
  SOURCE_AUDIO_MISSING: '영상에서 음성 트랙을 찾지 못했습니다.',
  AUDIO_EXTRACTION_FAILED: '영상에서 음성을 추출하지 못했습니다.',
  AUDIO_CHUNK_TOO_LARGE: '자막 처리용 음성 청크가 허용 크기를 초과했습니다.',
  STT_MODEL_UNAVAILABLE: '자막 생성 모델을 사용할 수 없습니다.',
  STT_PROVIDER_UNAVAILABLE: '자막 생성 서비스에 일시적인 문제가 있습니다.',
  STT_RESPONSE_INVALID: '자막 생성 결과를 확인하지 못했습니다.',
  RETRY_EXHAUSTED: '자막 생성 재시도 횟수를 초과했습니다.',
}

export function recordedCaptionFailureMessage(failureCode: string | null) {
  if (!failureCode) return 'AI 자막 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.'
  return CAPTION_FAILURE_MESSAGES[failureCode]
    ?? 'AI 자막 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.'
}

export function recordedPlaybackErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) {
    return '재생 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }
  if (error.code === 'RECORDED_VIDEO_NOT_READY' || error.code === 'RECORDED_VIDEO_NOT_PUBLISHED') {
    return '영상과 자막의 게시 상태를 다시 확인하고 있습니다.'
  }
  if (error.code === 'PLAYBACK_STORAGE_UNAVAILABLE') return '영상 저장소에 일시적인 문제가 있습니다.'
  if (error.code === 'ENROLLMENT_REQUIRED') return '이 녹화강의를 확인할 권한이 없습니다.'
  if (error.code === 'RECORDED_VIDEO_NOT_FOUND' || error.status === 404) return '녹화강의를 찾을 수 없습니다.'
  if (error.code === 'RECORDED_PLAYBACK_CONTRACT_INVALID') return '재생 정보가 올바르게 전달되지 않았습니다.'
  return error.message || '재생 정보를 가져오지 못했습니다.'
}
