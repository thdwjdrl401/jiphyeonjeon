export default function CurriculumDetailSkeleton() {
  return (
    <div className="curriculum-detail-skeleton page-container" aria-busy="true" aria-label="커리큘럼 정보를 불러오는 중">
      <div className="curriculum-detail-skeleton__hero" />
      <div className="curriculum-detail-skeleton__content">
        <div className="curriculum-detail-skeleton__main">
          <div className="curriculum-detail-skeleton__block" />
          <div className="curriculum-detail-skeleton__outline">
            {Array.from({ length: 4 }, (_, index) => (
              <div className="curriculum-detail-skeleton__row" key={index} />
            ))}
          </div>
        </div>
        <div className="curriculum-detail-skeleton__sidebar">
          <div className="curriculum-detail-skeleton__block" />
          <div className="curriculum-detail-skeleton__block" />
          <div className="curriculum-detail-skeleton__block" />
        </div>
      </div>
    </div>
  )
}
