/**
 * components/TagInput.tsx —— 标签联想补全输入（阶段 5c，AC4 / R14 / R15）
 *
 * 行为：
 * - 输入实时联想：suggestTags 模糊匹配 tags.name + aliases（R14，AC4：
 *   输入 "deep" 命中别名含 "deep learning" 的 #深度学习 标签）
 * - 选中写入 chip：存 canonical tagId（R15 数据层约束），展示统一规范名（TagChip）
 * - 无匹配时回车直接创建：走 tags store create（归并语义，命中别名返回既有标签）
 * - 键盘：↑/↓ 移动高亮、Enter 选中高亮项（无匹配则创建）、Backspace 空输入删除
 *   末尾 chip、Esc 关闭弹层
 * - 结构遵循 shadcn 规则：Command 内 CommandGroup/CommandItem 分组；
 *   弹层用 Popover（Portal 渲染，800×600 下不被表单滚动容器裁剪）
 * - 提交语义：表单保存时仍经 resolveTagIds 统一归并（唯一入口；本组件 eager create
 *   已保证 chip 均为 canonical tagId，resolve 为幂等归一）
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { XIcon } from 'lucide-react'

import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { matchTag, suggestTags } from '@/services/tagNormalize'
import { useTagsStore } from '@/stores/tags'
import type { Tag } from '@/types'

interface TagInputProps {
  /** 已选标签 canonical tagId 列表 */
  value: string[]
  onChange(ids: string[]): void
  placeholder?: string
  disabled?: boolean
  id?: string
}

/** 弹层候选：新建项（无精确匹配时置顶）或既有标签 */
type Candidate =
  | { kind: 'create' }
  | { kind: 'tag'; tag: Tag }

export default function TagInput({
  value,
  onChange,
  placeholder,
  disabled,
  id,
}: TagInputProps) {
  const tags = useTagsStore((s) => s.tags)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  /** 键盘高亮下标（自管理：CommandInput 不承担输入，cmdk 内置键盘不适用） */
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const selectedSet = useMemo(() => new Set(value), [value])
  const suggestions = useMemo(
    () => suggestTags(query, tags, 8).filter((t) => !selectedSet.has(t._id)),
    [query, tags, selectedSet],
  )

  const candidates: Candidate[] = useMemo(() => {
    const list: Candidate[] = []
    const q = query.trim()
    if (q && !matchTag(q, tags)) list.push({ kind: 'create' })
    for (const t of suggestions) list.push({ kind: 'tag', tag: t })
    return list
  }, [query, tags, suggestions])

  /** 高亮项滚动进可视区 */
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const commit = (tag: Tag) => {
    if (!selectedSet.has(tag._id)) onChange([...value, tag._id])
    setQuery('')
    setActive(0)
  }

  /** 回车创建新标签：store.create 归并语义（name/aliases 精确命中返回既有标签） */
  const createNew = async () => {
    const name = query.trim()
    if (!name) return
    try {
      const tag = await useTagsStore.getState().create({ name })
      commit(tag)
    } catch (err) {
      toast.error(`创建标签失败：${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* 已选 chips（规范名展示 + 可移除） */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((id) => {
            const tag = tags.find((t) => t._id === id)
            if (!tag) return null
            return (
              <span
                key={id}
                className="flex h-5 items-center gap-0.5 rounded-md bg-secondary py-0.5 pl-1.5 pr-0.5 text-xs"
                title={tag.aliases.length > 0 ? `别名：${tag.aliases.join('、')}` : undefined}
              >
                <span className="text-muted-foreground">#</span>
                {tag.name}
                <button
                  type="button"
                  aria-label={`移除标签 ${tag.name}`}
                  className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  onClick={() => onChange(value.filter((v) => v !== id))}
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            )
          })}
        </div>
      )}

      <Popover open={open} onOpenChange={(o) => setOpen(o)}>
        <PopoverAnchor asChild>
          <Input
            id={id}
            value={query}
            disabled={disabled}
            placeholder={placeholder ?? '输入标签名，回车直接创建'}
            onChange={(e) => {
              setQuery(e.target.value)
              setActive(0)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setOpen(true)
                setActive((a) => (candidates.length > 0 ? Math.min(a + 1, candidates.length - 1) : 0))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive((a) => Math.max(a - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                const c = candidates[active]
                if (!c) return
                if (c.kind === 'tag') commit(c.tag)
                else void createNew()
              } else if (e.key === 'Backspace' && query === '' && value.length > 0) {
                onChange(value.slice(0, -1))
              } else if (e.key === 'Escape') {
                setOpen(false)
                setActive(0)
              }
            }}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="w-[var(--radix-popover-trigger-width)] min-w-72 p-0"
        >
          <Command shouldFilter={false} className="rounded-lg! p-0!">
            <CommandList className="max-h-56" ref={listRef}>
              <CommandGroup>
                {candidates.map((c, i) =>
                  c.kind === 'create' ? (
                    <CommandItem
                      key="create"
                      data-active={active === i}
                      onSelect={() => void createNew()}
                      className={cn(active === i && 'bg-muted text-foreground')}
                    >
                      <span className="text-muted-foreground">＋</span>
                      <span>
                        创建标签「<span className="font-medium">{query.trim()}</span>」
                      </span>
                    </CommandItem>
                  ) : (
                    <CommandItem
                      key={c.tag._id}
                      data-active={active === i}
                      onSelect={() => commit(c.tag)}
                      className={cn(
                        'justify-start',
                        active === i && 'bg-muted text-foreground',
                      )}
                    >
                      <span className="text-muted-foreground">#</span>
                      <span className="shrink-0">{c.tag.name}</span>
                      {c.tag.aliases.length > 0 && (
                        <span className="truncate text-xs text-muted-foreground">
                          {c.tag.aliases.join('、')}
                        </span>
                      )}
                    </CommandItem>
                  ),
                )}
                {candidates.length === 0 && (
                  <CommandItem disabled className="cursor-default text-muted-foreground">
                    {query.trim() ? '无匹配标签，回车直接创建' : '输入标签名开始联想'}
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
