/** A superscript "AI" after a name: an agent in Who's here, or a loop an agent added. */
export function AiMark({ title }: { title?: string }) {
  return (
    <sup className="console-ai" title={title}>
      AI
    </sup>
  )
}
