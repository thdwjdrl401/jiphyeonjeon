import type {
  ProcessingStatus,
  VideoAssetStatus,
} from './liveSessionService.interface'

export const PROCESSING_FAST_WINDOW_MS = 30_000
export const PROCESSING_FAST_INTERVAL_MS = 2_000
export const PROCESSING_SLOW_INTERVAL_MS = 5_000

export type ProcessingStepState = 'COMPLETE' | 'PROCESSING' | 'PENDING' | 'FAILED'

export interface ProcessingStep {
  label: string
  status: ProcessingStepState
}

export function isReplayReady(status: ProcessingStatus | undefined) {
  return status?.videoAsset?.status === 'READY'
    && status.videoAsset.replayStatus === 'PUBLISHED'
}

/** READY(게시 여부와 무관)·FAILED·녹화 비활성은 더 이상 서버 상태가 자동 전이하지 않는다. */
export function isProcessingTerminal(status: ProcessingStatus | undefined) {
  if (!status) return false
  const assetStatus = status.videoAsset?.status
  return (status.videoAsset === null && !status.recordingEnabled)
    || assetStatus === 'READY'
    || assetStatus === 'FAILED'
}

/** TanStack Query의 refetchInterval에서 쓰는 ADR-0007 폴링 정책. */
export function processingPollInterval(status: ProcessingStatus | undefined, elapsedMs: number) {
  if (isProcessingTerminal(status)) return false as const
  return elapsedMs < PROCESSING_FAST_WINDOW_MS
    ? PROCESSING_FAST_INTERVAL_MS
    : PROCESSING_SLOW_INTERVAL_MS
}

function reached(current: VideoAssetStatus | undefined, targets: VideoAssetStatus[]) {
  return current !== undefined && targets.includes(current)
}

export function buildProcessingSteps(status: ProcessingStatus): ProcessingStep[] {
  const assetStatus = status.videoAsset?.status
  const failed = assetStatus === 'FAILED'
  return [
    {
      label: '라이브 종료 확정',
      status: status.liveSessionStatus === 'ENDED' ? 'COMPLETE' : 'PROCESSING',
    },
    {
      label: 'HLS 녹화 파일 마무리',
      status: failed
        ? 'FAILED'
        : reached(assetStatus, ['VERIFYING', 'READY'])
          ? 'COMPLETE'
          : 'PROCESSING',
    },
    {
      label: '재생 가능성 검증',
      status: failed
        ? 'FAILED'
        : assetStatus === 'READY'
          ? 'COMPLETE'
          : assetStatus === 'VERIFYING'
            ? 'PROCESSING'
            : 'PENDING',
    },
    {
      label: '다시보기 공개',
      status: isReplayReady(status)
        ? 'COMPLETE'
        : failed
          ? 'FAILED'
          : 'PENDING',
    },
  ]
}
