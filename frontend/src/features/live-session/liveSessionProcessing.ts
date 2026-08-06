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

/** 강의 상세의 다시보기 배지가 말할 내용. `null`이면 배지를 그리지 않는다. */
export interface ReplayBadgeView {
  tone: 'success' | 'warning' | 'danger'
  label: string
  /** 아직 서버 상태가 움직이는 중인가 — 배지 안에서 원이 돈다. */
  busy: boolean
  /** 눌렀을 때 갈 곳. 처리 단계를 봐야 하면 processing, 볼 게 있으면 replay. */
  goTo: 'processing' | 'replay' | null
  /** 배지 옆에 적는 한 줄. 강사가 지금 뭘 할 수 있는지. */
  hint: string
}

/**
 * 녹화 처리 상태를 강의 상세의 배지 한 개로 압축한다.
 *
 * <p>예전에는 이 자리에 <b>"VIDEO READY"가 문자열로 박혀 있었다.</b> 인코딩이 돌고 있든 실패했든
 * 강사에게는 언제나 "검수 가능"으로 보였고, 눌러 들어가면 재생이 안 됐다. [ADR-0092]가 종료 동선을
 * 강의 상세로 바꾸면서 "상세가 이미 준비 상태를 보여 준다"를 전제로 삼았는데, 그 표시가 실제로는
 * 없었다 — 이 함수가 그 빠진 자리를 채운다.
 *
 * <p>단계 목록(4개)은 배지에 넣지 않는다. 자세히 볼 사람은 배지를 눌러 처리 화면으로 간다
 * (ADR-0092가 그 화면을 남겨 둔 이유다).
 */
export function describeReplayBadge(
  status: ProcessingStatus | undefined,
  loading: boolean,
): ReplayBadgeView | null {
  // 애초에 녹화를 안 켠 강의 — 없는 것을 준비 중이라고 말하지 않는다.
  if (status && status.videoAsset === null && !status.recordingEnabled) return null

  if (loading || !status) {
    return { tone: 'warning', label: '녹화 상태 확인 중', busy: true, goTo: null, hint: '' }
  }

  const asset = status.videoAsset
  if (asset?.status === 'FAILED') {
    return {
      tone: 'danger',
      label: '녹화 처리 실패',
      busy: false,   // 실패는 끝난 상태다. 원이 계속 돌면 아직 되는 중으로 읽힌다.
      goTo: 'processing',
      hint: '어느 단계에서 멈췄는지 확인하고 다시 시도할 수 있습니다.',
    }
  }
  if (asset?.status === 'READY') {
    return asset.replayStatus === 'PUBLISHED'
      ? {
        tone: 'success',
        label: '다시보기 공개됨',
        busy: false,
        goTo: 'replay',
        hint: '수강생이 지금 볼 수 있습니다.',
      }
      : {
        tone: 'warning',
        label: '검수 대기',
        busy: false,
        goTo: 'replay',
        hint: '영상은 준비됐습니다. 검수 후 공개해 주세요.',
      }
  }

  // STARTING·RECORDING·FINALIZING·VERIFYING, 그리고 아직 자산이 안 생긴 구간.
  return {
    tone: 'warning',
    label: '녹화 처리 중',
    busy: true,
    goTo: 'processing',
    hint: '끝나면 이 자리에서 바로 검수할 수 있습니다.',
  }
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
