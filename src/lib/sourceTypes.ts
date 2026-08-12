/**
 * lib/sourceTypes.ts —— 来源类型展示助手（R4 枚举的 UI 侧投影）
 *
 * - sourceTypeIcon：内置六种类型的图标映射（自定义类型回退通用图标）
 * - sourceTypeLabel：id → 中文展示名（读自 db 枚举，含自定义；未知 id 回退原样）
 * - useSourceTypes：db 枚举的轻量 hook（模块级缓存）；设置域二期接入 store 后替换
 */
import { useEffect, useState } from 'react'
import {
  BookOpenIcon,
  FileTextIcon,
  FileSearchIcon,
  GitBranchIcon,
  GraduationCapIcon,
  VideoIcon,
  type LucideIcon,
} from 'lucide-react'

import { getSourceTypes } from '@/services/db'
import { BUILTIN_SOURCE_TYPES, type SourceType } from '@/types'

const BUILTIN_ICONS: Record<string, LucideIcon> = {
  book: BookOpenIcon,
  article: FileTextIcon,
  video: VideoIcon,
  paper: FileSearchIcon,
  github: GitBranchIcon,
  course: GraduationCapIcon,
}

/** 来源类型 → lucide 图标（未知/自定义回退 FileText） */
export function sourceTypeIcon(id: string): LucideIcon {
  return BUILTIN_ICONS[id] ?? FileTextIcon
}

/** 来源类型 id → 展示名（未在枚举中找到时回退原样 id） */
export function sourceTypeLabel(id: string, sourceTypes: SourceType[]): string {
  return sourceTypes.find((st) => st.id === id)?.label ?? id
}

let cached: SourceType[] | null = null

/** db 来源类型枚举（异步一次加载，模块级缓存；跨组件共享同一份） */
export function useSourceTypes(): SourceType[] {
  const [types, setTypes] = useState<SourceType[]>(cached ?? BUILTIN_SOURCE_TYPES)
  useEffect(() => {
    if (!cached) {
      void getSourceTypes().then((t) => {
        cached = t
        setTypes(t)
      })
    }
  }, [])
  return types
}
