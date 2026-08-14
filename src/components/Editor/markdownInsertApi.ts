/**
 * components/Editor/markdownInsertApi.ts —— MarkdownInsertApi 的 CM6 实现（atomic-editor 内核）
 *
 * 任务 08-14-editor-cm6-research：CM6 文档即源码字符串，所有插入命令直接做「源码偏移
 * 编辑」（view.dispatch changes），语义与 Milkdown 版本一致但实现从 ProseMirror 命令
 * 改为字符串偏移：
 * - wrap：选中文本包裹 before..after；无选中插 before+placeholder+after，光标居中
 * - block：行级（标题/列表/引用/勾选框）+ 块级（```围栏/$$公式块/表格/---分割线）
 * - insertImage：`![文件名](路径)`，路径中 () 转义
 * - jumpTo(item)：按 item.offset 滚动 + 移动光标（恢复 offset 契约，替代 Milkdown 的
 *   level+text 匹配——CM6 下源码偏移直接有效）
 * - focus
 *
 * view 获取：惰性 getView()（编辑器挂载前为 null → 各操作安全 no-op）。
 */
import { syntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'

import type { OutlineItem } from '@/lib/outline'
import { UNDERLINE_RE } from './extensions/underlineDecoration'

/** 快捷工具栏插入 API（MarkdownToolbar 消费；契约与 Milkdown 版本一致） */
export interface MarkdownInsertApi {
  /** 包裹：选中文本包 before..after；无选中插 before+placeholder+after，光标居中 */
  wrap(before: string, after?: string, placeholder?: string): void
  /**
   * 行级插入：空行直接行首插入；非空行在行首插入（行首已有标题标记时替换级别）
   * block=true 时在光标处插入多行块（prefix\n\nsuffix\n），光标居中
   */
  block(prefix: string, suffix?: string, opts?: { block?: boolean; placeholder?: string }): void
  /** 插入图片语法 `![文件名](路径)`，光标落在末尾（路径中 () 已转义） */
  insertImage(path: string): void
  /** 跳转定位：按大纲项 offset 滚动并移动光标（元信息面板大纲跳转用） */
  jumpTo(item: OutlineItem): void
  /**
   * 内联格式 toggle（完成/取消）：选中文字前后缀判断包裹/取消；无选中时若光标在
   * 对应格式内（nodeName 走语法树、下划线走正则）则取消，否则生成空标记光标居中。
   */
  toggleInline(open: string, close?: string, nodeName?: string): void
  focus(): void
}

/** 工厂：getView 惰性取当前 EditorView（编辑器挂载前为 null → 各操作安全 no-op） */
export function createMarkdownInsertApi(getView: () => EditorView | null): MarkdownInsertApi {
  return {
    wrap(before, after = before, placeholderText = '') {
      const view = getView()
      if (!view) return
      const { from, to } = view.state.selection.main
      const sel = view.state.sliceDoc(from, to)
      const text = sel ? before + sel + after : before + placeholderText + after
      view.dispatch({
        changes: { from, to, insert: text },
        selection: sel ? { anchor: from + text.length } : { anchor: from + before.length },
      })
      view.focus()
    },

    block(prefix, suffix = '', opts = {}) {
      const view = getView()
      if (!view) return
      const { head } = view.state.selection.main
      const line = view.state.doc.lineAt(head)
      const lineText = view.state.sliceDoc(line.from, line.to)

      if (opts.block) {
        // 多行块（代码块/公式块/表格/分割线）：光标处插入，光标落在内容起点/末尾。
        // 光标不在行首时补换行（围栏/表格必须行首独立成块）。
        // 列表项内插入：额外空行退出列表（否则 ```/表格 成为列表项内容不解析）。
        // 围栏内容区内插入：落到围栏结束后（否则表格/代码块进入代码内容不渲染）。
        let insertPos = head
        let lead = head > line.from ? '\n' : ''
        if (/^\s*(?:[-*+]|\d+[.)])\s/.test(lineText)) lead += '\n'
        const tree = syntaxTree(view.state)
        let node = tree.resolveInner(head, 1)
        while (node.parent && node.name !== 'FencedCode') node = node.parent
        if (node.name === 'FencedCode') {
          const marks = node.getChildren('CodeMark')
          const contentFrom = marks[0]?.to ?? node.from
          const contentTo = marks.length > 1 ? marks[marks.length - 1].from : node.to
          const openLine = view.state.doc.lineAt(Math.min(contentFrom, view.state.doc.length)).number
          const closeLine = view.state.doc.lineAt(Math.min(contentTo, view.state.doc.length)).number
          const cursorLine = view.state.doc.lineAt(head).number
          if (cursorLine >= openLine && cursorLine <= closeLine) {
            insertPos = node.to
            lead = '\n\n'
          }
        }
        const text = lead + (suffix ? `${prefix}\n\n${suffix}\n` : prefix)
        const caret = insertPos + (suffix ? lead.length + prefix.length + 1 : text.length)
        view.dispatch({
          changes: { from: insertPos, to: insertPos, insert: text },
          selection: { anchor: caret },
        })
        view.focus()
        return
      }

      // 行级：标题/列表/引用/勾选框——光标落在标记之后（prefix.length）
      const insert = (text: string, cursorOffset: number) => {
        view.dispatch({
          changes: { from: line.from, to: line.from, insert: text },
          selection: { anchor: head + cursorOffset },
        })
      }
      // 标题：行首已有 # 标记则替换级别（如 ## → #）
      const headingMatch = /^#{1,6}\s+/.exec(lineText)
      if (/^#{1,6}\s+/.test(prefix) && headingMatch) {
        const headFrom = line.from + headingMatch[0].length
        view.dispatch({
          changes: { from: line.from, to: headFrom, insert: prefix },
          selection: { anchor: head + (prefix.length - headingMatch[0].length) },
        })
        view.focus()
        return
      }
      if (lineText.trim() === '') {
        // 空行：行首插 prefix（+placeholder），光标在 prefix 后
        const ph = opts.placeholder ?? ''
        insert(prefix + ph, prefix.length)
      } else if (lineText.startsWith(prefix.trimStart())) {
        // 已有同类型标记：不重复插入，仅聚焦
        view.focus()
      } else {
        insert(prefix, prefix.length)
      }
      view.focus()
    },

    insertImage(path) {
      const view = getView()
      if (!view) return
      const { head } = view.state.selection.main
      const alt = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? '图片'
      // 路径中 () 需转义（markdown 链接语法冲突），空格/中文 GFM 直接可用
      const safePath = path.replace(/\(/g, '%28').replace(/\)/g, '%29')
      const text = `![${alt}](${safePath})`
      view.dispatch({
        changes: { from: head, to: head, insert: text },
        selection: { anchor: head + text.length },
      })
      view.focus()
    },

    jumpTo(item) {
      const view = getView()
      if (!view) return
      const pos = item.offset
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos),
      })
      view.focus()
    },

    focus() {
      getView()?.focus()
    },

    toggleInline(open, close = open, nodeName) {
      const view = getView()
      if (!view) return
      const { state } = view
      const { from, to } = state.selection.main

      // 有选中：前后缀判断包裹/取消
      if (from !== to) {
        const before = state.sliceDoc(Math.max(0, from - open.length), from)
        const after = state.sliceDoc(to, to + close.length)
        if (before === open && after === close) {
          view.dispatch({
            changes: [
              { from: from - open.length, to: from },
              { from: to, to: to + close.length },
            ],
            selection: { anchor: from - open.length },
          })
        } else {
          const sel = state.sliceDoc(from, to)
          view.dispatch({
            changes: { from, to, insert: open + sel + close },
            selection: { anchor: to + open.length + close.length },
          })
        }
        view.focus()
        return
      }

      // 无选中：加粗/斜体走语法树定位格式内取消
      if (nodeName) {
        const node = syntaxTree(state).resolveInner(from, 1)
        let n: typeof node | null = node
        let target: typeof node | null = null
        while (n && n.name !== 'Document') {
          if (n.name === nodeName && n.from < n.to) {
            target = n
            break
          }
          n = n.parent
        }
        if (target) {
          view.dispatch({
            changes: [
              { from: target.from, to: target.from + open.length },
              { from: target.to - close.length, to: target.to },
            ],
            selection: { anchor: target.from },
          })
          view.focus()
          return
        }
      } else {
        // 下划线：正则找光标所在包裹对
        const text = state.doc.toString()
        UNDERLINE_RE.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = UNDERLINE_RE.exec(text)) !== null) {
          const uFrom = m.index
          const uTo = m.index + m[0].length
          if (from > uFrom && from < uTo) {
            view.dispatch({
              changes: [
                { from: uFrom, to: uFrom + open.length },
                { from: uTo - close.length, to: uTo },
              ],
              selection: { anchor: uFrom },
            })
            view.focus()
            return
          }
        }
      }

      // 均未命中：生成空标记，光标居中
      view.dispatch({
        changes: { from, to: from, insert: open + close },
        selection: { anchor: from + open.length },
      })
      view.focus()
    },
  }
}
