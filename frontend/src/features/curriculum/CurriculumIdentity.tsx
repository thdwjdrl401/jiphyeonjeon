interface CurriculumIdentityProps {
  title: string
  summary: string
  lifecycleStatus: string
}

const lifecycleLabel: Record<string, string> = {
  PUBLISHED: '공개 중',
  DRAFT: '준비 중',
  CLOSED: '운영 종료',
}

export default function CurriculumIdentity({ title, summary, lifecycleStatus }: CurriculumIdentityProps) {
  return (
    <div className="curriculum-identity">
      <span className="status-badge">{lifecycleLabel[lifecycleStatus] ?? lifecycleStatus}</span>
      <h1>{title}</h1>
      <p>{summary}</p>
    </div>
  )
}
