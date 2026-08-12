/**
 * components/TagChip.tsx —— 标签展示 chip（跨组件复用：元数据条 / 笔记卡片 / 全文页）
 *
 * 展示统一显示规范名（R15：别名只用于归并与联想，展示一律 canonical name）。
 */
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Tag } from '@/types'

export default function TagChip({
  tag,
  className,
}: {
  tag: Tag
  className?: string
}) {
  return (
    <Badge
      variant="secondary"
      className={cn('h-5 rounded-md px-1.5 text-xs font-normal', className)}
      title={tag.aliases.length > 0 ? `别名：${tag.aliases.join('、')}` : undefined}
    >
      <span className="text-muted-foreground">#</span>
      {tag.name}
    </Badge>
  )
}
