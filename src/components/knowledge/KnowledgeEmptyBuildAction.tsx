import { Loader2, Network } from "lucide-react"
import { Button } from "@/components/ui/button"

type KnowledgeEmptyBuildActionProps = {
  title: string
  building?: boolean
  onBuildKnowledge?: () => void
}

export function KnowledgeEmptyBuildAction({
  title,
  building = false,
  onBuildKnowledge,
}: KnowledgeEmptyBuildActionProps) {
  return (
    <div className="rounded-md border border-dashed px-3 py-5 text-center text-xs leading-5 text-muted-foreground">
      <div>{title}</div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-3 h-8"
        onClick={onBuildKnowledge}
        disabled={building || !onBuildKnowledge}
      >
        {building ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Network className="mr-1.5 h-3.5 w-3.5" />}
        {building ? "生成中" : "从整本书生成"}
      </Button>
    </div>
  )
}
