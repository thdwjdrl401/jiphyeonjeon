interface CurriculumOverviewProps {
  description: string
}

export default function CurriculumOverview({ description }: CurriculumOverviewProps) {
  return (
    <section className="curriculum-overview" aria-labelledby="curriculum-overview-heading">
      <h2 id="curriculum-overview-heading">커리큘럼 소개</h2>
      <p>{description}</p>
    </section>
  )
}
