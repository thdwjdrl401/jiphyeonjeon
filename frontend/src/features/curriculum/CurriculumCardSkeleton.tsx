interface CurriculumCardSkeletonProps {
  count?: number
}

export default function CurriculumCardSkeleton({ count = 3 }: CurriculumCardSkeletonProps) {
  return (
    <div className="curriculum-grid" aria-label="커리큘럼을 불러오는 중" role="status">
      {Array.from({ length: count }, (_, index) => (
        <div className="curriculum-skeleton" key={index} aria-hidden="true">
          <span className="skeleton-block skeleton-cover" />
          <span className="skeleton-block skeleton-line skeleton-line--short" />
          <span className="skeleton-block skeleton-line skeleton-line--title" />
          <span className="skeleton-block skeleton-line" />
          <span className="skeleton-block skeleton-line skeleton-line--medium" />
        </div>
      ))}
      <span className="visually-hidden">커리큘럼을 불러오고 있습니다.</span>
    </div>
  )
}
