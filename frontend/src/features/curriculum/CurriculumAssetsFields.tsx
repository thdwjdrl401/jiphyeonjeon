import CurriculumImageField, { type CurriculumImageSelection } from './CurriculumImageField'
import CurriculumMaterialField from './CurriculumMaterialField'
import type { CurriculumMaterial } from './types'

interface CurriculumAssetsFieldsProps {
  /** 같은 화면에 두 벌이 뜨지 않더라도 input id는 화면마다 달라야 한다(label htmlFor 충돌 방지). */
  idPrefix: string
  thumbnailPreviewUrl: string | null
  onThumbnailChange: (selection: CurriculumImageSelection | null) => void
  materials: CurriculumMaterial[]
  onMaterialsChange: (materials: CurriculumMaterial[]) => void
  /** 저장된 자료의 다운로드 링크(관리 화면). 새 커리큘럼 만들기에서는 아직 저장 전이라 주지 않는다. */
  materialDownloadHref?: (material: CurriculumMaterial) => string
  /** 대표 이미지 삭제를 지금 할 수 없는 이유(CurriculumImageField 참조). */
  thumbnailRemoveDisabledReason?: string
}

/**
 * "대표 이미지와 강의 자료" 카드 본문. 새 커리큘럼 만들기와 커리큘럼 관리 > 기본 정보가
 * 같은 UI를 쓰도록 한 곳에 모았다 — 예전엔 관리 화면이 별도 마크업이라 여백·제목 스타일이 갈렸다.
 * 패널(제목·설명) 껍데기는 화면마다 다를 수 있어 호출부가 감싼다.
 */
export default function CurriculumAssetsFields({
  idPrefix,
  thumbnailPreviewUrl,
  onThumbnailChange,
  materials,
  onMaterialsChange,
  materialDownloadHref,
  thumbnailRemoveDisabledReason,
}: CurriculumAssetsFieldsProps) {
  return (
    <div className="curriculum-assets-grid">
      <section className="curriculum-asset-section">
        <h3>대표 이미지</h3>
        <p>목록과 상세 화면에서 커리큘럼을 구분하는 이미지입니다.</p>
        <CurriculumImageField
          id={`${idPrefix}-thumbnail`}
          previewUrl={thumbnailPreviewUrl}
          onChange={onThumbnailChange}
          removeDisabledReason={thumbnailRemoveDisabledReason}
        />
      </section>
      <section className="curriculum-asset-section">
        <h3>커리큘럼 강의 자료 <small>선택</small></h3>
        <p>수강 중인 학생에게 모든 강의에서 공통으로 제공할 PPTX 자료입니다.</p>
        <CurriculumMaterialField
          id={`${idPrefix}-materials`}
          value={materials}
          onChange={onMaterialsChange}
          downloadHref={materialDownloadHref}
        />
      </section>
    </div>
  )
}
