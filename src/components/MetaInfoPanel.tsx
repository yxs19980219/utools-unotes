/**
 * components/MetaInfoPanel.tsx —— ⓘ 元信息面板（需求 6-7，08-13-header-metainfo）
 *
 * 内容：创建时间 / 更新时间 / 字数 / 大纲列表（点击跳转编辑器对应标题）。
 * - Popover 由按钮触发，内容侧对齐；大纲项点击 → onJump(offset) 滚动定位
 * - 大纲解析走 lib/outline.ts 纯函数（parseOutline）
 */
import { useMemo } from 'react'
import { Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { formatTime } from '@/lib/format'
import { countChars, parseOutline, type OutlineItem } from '@/lib/outline'
import { cn } from '@/lib/utils'
import type { Note } from '@/types'

interface MetaInfoPanelProps {
  note: Note
  /** 大纲项点击：跳转编辑器到对应标题（WYSIWYG 下按 level+text 定位，非源码偏移） */
  onJump(item: OutlineItem): void
  className?: string
}

export default function MetaInfoPanel({ note, onJump, className }: MetaInfoPanelProps) {
  const outline = useMemo(() => parseOutline(note.content), [note.content])
  const chars = useMemo(() => countChars(note.content), [note.content])

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn('text-muted-foreground', className)}
          aria-label="查看元信息"
        >
          <Info data-icon />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={4}
        className="w-64"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-3">
          {/* 时间与字数 */}
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">创建时间</dt>
              <dd>{formatTime(note.createdAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">更新时间</dt>
              <dd>{formatTime(note.updatedAt)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">字数</dt>
              <dd>{chars}</dd>
            </div>
          </dl>

          {/* 大纲 */}
          {outline.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              <div className="text-xs font-medium text-muted-foreground">大纲</div>
              <div className="max-h-56 overflow-y-auto">
                {outline.map((item) => (
                  <button
                    key={item.offset}
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-sm transition-colors hover:bg-accent"
                    style={{ paddingLeft: `${(item.level - 1) * 0.9 + 0.25}rem` }}
                    onClick={() => onJump(item)}
                  >
                    <span className="shrink-0 text-[0.65rem] text-muted-foreground">
                      {'#'.repeat(item.level)}
                    </span>
                    <span className="truncate">{item.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">暂无大纲（正文无标题）</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
