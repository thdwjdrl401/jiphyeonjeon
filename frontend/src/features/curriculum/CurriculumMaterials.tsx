import type { CurriculumMaterial } from './types'

interface CurriculumMaterialsProps {
  materials: CurriculumMaterial[]
}

function formatFileSize(fileSize: number) {
  if (fileSize < 1024 * 1024) return `${Math.max(1, Math.round(fileSize / 1024))} KB`
  return `${(fileSize / 1024 / 1024).toFixed(1)} MB`
}

export default function CurriculumMaterials({ materials }: CurriculumMaterialsProps) {
  return (
    <section className="curriculum-materials" aria-labelledby="curriculum-materials-heading">
      <header>
        <div><h2 id="curriculum-materials-heading">커리큘럼 강의 자료</h2><p>전체 강의에서 공통으로 사용하는 자료입니다.</p></div>
        <span>{materials.length}개</span>
      </header>
      <ul>
        {materials.map((material) => (
          <li key={material.materialId}>
            <span className="curriculum-materials__icon">PPTX</span>
            <div><strong>{material.fileName}</strong><small>{formatFileSize(material.fileSize)}</small></div>
          </li>
        ))}
      </ul>
    </section>
  )
}
