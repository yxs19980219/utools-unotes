/**
 * components/SidebarRow.tsx —— 侧边栏列表项（首页/标签视图共用）
 *
 * 阶段 4 接入联动：onClick → ui.selectObject / ui.selectTag；选中行
 * data-selected="true" + accent 高亮（data-selected 样式由 Tailwind data 变体驱动）。
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface SidebarRowProps {
  /** 行首图标（lucide 组件实例） */
  icon?: ReactNode
  /** 主文本（对象标题/标签规范名），超长省略 */
  label: string
  /** 右侧角标（如标签笔记计数） */
  badge?: number
  /** 右侧弱化文本（如归档时间；不受 hover 控制） */
  trailing?: ReactNode
  /** 弱化显示（如空标题兜底） */
  muted?: boolean
  /** 选中高亮（与 ui store 选中项联动） */
  active?: boolean
  /** 点击联动（selectObject / selectTag）；缺省为纯展示行 */
  onClick?: () => void
  /** 行右侧悬停操作区（阶段 6 标签行操作；点击不触发行选中） */
  actions?: ReactNode
  /** 右键菜单透传（ContextMenuTrigger asChild 注入；SidebarRow 需转发到根元素） */
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void
  className?: string
}

export default function SidebarRow({
  icon,
  label,
  badge,
  trailing,
  muted,
  active,
  onClick,
  actions,
  onContextMenu,
  className,
}: SidebarRowProps) {
  const interactive = typeof onClick === 'function'
  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      data-selected={active ? 'true' : 'false'}
      onClick={interactive ? onClick : undefined}
      onContextMenu={onContextMenu}
      onKeyDown={(e) => {
        if (interactive && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onClick()
        }
      }}
      className={cn(
        'group flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm transition-colors data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground',
        interactive && 'cursor-pointer outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        !active && 'hover:bg-muted',
        muted && !active && 'text-muted-foreground',
        className,
      )}
    >
      {icon ? (
        <span
          data-icon
          className="shrink-0 text-muted-foreground [&_svg]:size-3.5 group-data-[selected=true]:text-accent-foreground"
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate" title={label}>
        {label}
      </span>
      {badge !== undefined && (
        <span className="shrink-0 rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
          {badge}
        </span>
      )}
      {trailing && (
        <span className="shrink-0 text-[0.7rem] text-muted-foreground/80">{trailing}</span>
      )}
      {actions && (
        <span
          className="hidden shrink-0 items-center gap-0.5 group-hover:flex"
          onClick={(e) => e.stopPropagation()}
        >
          {actions}
        </span>
      )}
    </div>
  )
}
