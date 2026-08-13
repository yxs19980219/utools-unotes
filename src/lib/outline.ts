/** lib/outline.ts —— 笔记大纲解析（纯函数，无 DOM 依赖） */
export interface OutlineItem {
  /** 标题级别 1-6 */
  level: number
  /** 标题文本（去标记，trim） */
  text: string
  /** 标题在文档中的字符偏移（供编辑器 jumpTo） */
  offset: number
}

const OUTLINE_RE = /^(#{1,6})\s+(.*)$/gm

/** 解析 markdown 正文的大纲：行首 # 1-6 级标题，按出现顺序 */
export function parseOutline(content: string): OutlineItem[] {
  const items: OutlineItem[] = []
  OUTLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = OUTLINE_RE.exec(content)) !== null) {
    items.push({ level: m[1].length, text: m[2].trim(), offset: m.index })
  }
  return items
}

/** 正文字数（按字符计，含标点；不含首尾空白） */
export function countChars(content: string): number {
  return content.trim().length
}
