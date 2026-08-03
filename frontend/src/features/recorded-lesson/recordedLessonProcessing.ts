import { ApiError } from '@/shared/api/client'
import type { RecordedProcessingStatus } from './recordedLessonService.interface'

const ACTIVE_PROCESSING_STATUSES = new Set<RecordedProcessingStatus>([
  'QUEUED',
  'TRANSCODING',
  'VERIFYING',
])

export const RECORDED_PROCESSING_POLL_INTERVAL_MS = 3_000

export function recordedProcessingPollInterval(status?: RecordedProcessingStatus) {
  return status && ACTIVE_PROCESSING_STATUSES.has(status)
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
    title: '재생 준비 완료',
    description: '녹화강의를 재생할 수 있습니다.',
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

export function recordedPlaybackErrorMessage(error: unknown) {
  if (!(error instanceof ApiError)) {
    return '재생 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.'
  }
  if (error.code === 'RECORDED_VIDEO_NOT_READY') return '영상 재생 준비 상태를 다시 확인하고 있습니다.'
  if (error.code === 'PLAYBACK_STORAGE_UNAVAILABLE') return '영상 저장소에 일시적인 문제가 있습니다.'
  if (error.code === 'ENROLLMENT_REQUIRED') return '이 녹화강의를 확인할 권한이 없습니다.'
  if (error.code === 'RECORDED_VIDEO_NOT_FOUND' || error.status === 404) return '녹화강의를 찾을 수 없습니다.'
  if (error.code === 'RECORDED_PLAYBACK_CONTRACT_INVALID') return '재생 정보가 올바르게 전달되지 않았습니다.'
  return error.message || '재생 정보를 가져오지 못했습니다.'
}
