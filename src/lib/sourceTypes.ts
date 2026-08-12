/**
 * lib/sourceTypes.ts —— 来源类型展示助手（R4 枚举的 UI 侧投影）
 *
 * - sourceTypeIcon：内置六种类型的图标映射（自定义类型回退通用图标）
 * - sourceTypeLabel：id → 中文展示名（读自 db 枚举，含自定义；未知 id 回退原样）
 * - useSourceTypes：读 settings store（二期改造：单一数据源，设置页增删改即时生效，
 *   替代一期模块级缓存——后者无失效机制，设置改动不生效）
 */
import {
  BookOpenIcon,
  FileTextIcon,
  FileSearchIcon,
  GitBranchIcon,
  GraduationCapIcon,
  VideoIcon,
  type LucideIcon,
} from 'lucide-react'

import { useSettingsStore } from '@/stores/settings'
import type { SourceType } from '@/types'

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

/** db 来源类型枚举（settings store 投影：设置页增删改即时生效，R8） */
export function useSourceTypes(): SourceType[] {
  return useSettingsStore((s) => s.sourceTypes)
}
