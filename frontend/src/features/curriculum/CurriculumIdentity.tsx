interface CurriculumIdentityProps {
  title: string
  summary: string
}

export default function CurriculumIdentity({ title, summary }: CurriculumIdentityProps) {
  return (
    <div className="curriculum-identity">
      <h1>{title}</h1>
      <p>{summary}</p>
    </div>
  )
}
