/**
 * components/Editor/markdownInsertApi.ts —— MarkdownInsertApi 的 Milkdown/ProseMirror 实现
 *
 * 语义与旧 CM6 实现（codeMirrorApi.ts）一致，内部从"源码编辑"改为文档模型命令：
 * - wrap：按 before 识别语法 → toggleMark（strong/em/strike/inline_code/highlight/
 *   underline/link）；`$` 行内公式 → 插入 math_inline 节点
 * - block：行级（标题/列表/引用/勾选）→ setBlockType / wrapInList / wrapInBlockquote；
 *   块级（代码块/公式块/表格/分割线）→ 插入节点
 * - insertImage：插入 image 节点（src=路径、alt=文件名去扩展）
 * - jumpTo(OutlineItem)：按 level+text 匹配 heading 节点定位（WYSIWYG 下源码偏移
 *   失效，契约改造为大纲项定位，见 task design 2.4）
 * - focus
 *
 * Editor 获取：惰性 getEditor()（编辑器挂载前为 null → 各操作安全 no-op）。
 * 所有命令在 editor.action 内拿 editorViewCtx 执行（ProseMirror 命令标准形态）。
 */
import { editorViewCtx } from '@milkdown/kit/core'
import type { Editor } from '@milkdown/kit/core'
import type { MarkType, Node as PmNode } from '@milkdown/kit/prose/model'
import { TextSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import {
  setBlockType,
  toggleMark,
  wrapIn,
} from '@milkdown/kit/prose/commands'
import { wrapInList } from '@milkdown/kit/prose/schema-list'
import { createTable } from '@milkdown/kit/preset/gfm'

import type { OutlineItem } from '@/lib/outline'

/** 快捷工具栏插入 API（MarkdownToolbar 消费；契约与旧内核一致） */
export interface MarkdownInsertApi {
  /** 包裹：选中文本包 before..after；无选中插 before+placeholder+after，光标落在占位符起始 */
  wrap(before: string, after?: string, placeholder?: string): void
  /**
   * 行级插入：标题/列表/引用/勾选作用于当前块（已在该结构时保持现状不重复）；
   * block=true 时在光标处插入多行块（代码块/公式块/表格/分割线）
   */
  block(prefix: string, suffix?: string, opts?: { block?: boolean; placeholder?: string }): void
  /** 插入图片语法（alt=文件名去扩展，src=路径） */
  insertImage(path: string): void
  /** 跳转定位：按大纲项（level+text）匹配标题节点，滚动并聚焦 */
  jumpTo(item: OutlineItem): void
  focus(): void
}

/** 工厂：getEditor 惰性取当前 Milkdown Editor（挂载前为 null → 各操作安全 no-op） */
export function createMarkdownInsertApi(getEditor: () => Editor | null): MarkdownInsertApi {
  /** 在编辑器 ctx 中执行命令（view 就绪才执行） */
  const withView = (fn: (view: EditorView) => void): void => {
    const editor = getEditor()
    if (!editor) return
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      if (!view || !view.editable) return
      fn(view)
    })
  }

  /** wrap 的 before → mark 类型名映射（schema.marks 取类型） */
  const markNameFor = (before: string): string | null => {
    switch (before) {
      case '**':
        return 'strong'
      case '*':
        return 'em'
      case '~~':
        return 'strike_through'
      case '`':
        return 'inline_code'
      case '==':
        return 'highlight'
      case '<u>':
        return 'underline'
      default:
        return null
    }
  }

  /** 无选中时：插入占位文本并应用 mark，光标落在占位符起始 */
  const insertMarkedPlaceholder = (
    view: EditorView,
    markType: MarkType,
    placeholderText: string,
  ): void => {
    const { from } = view.state.selection
    const text = placeholderText || ' '
    let tr = view.state.tr.insertText(text, from)
    tr = tr.addMark(from, from + text.length, markType.create())
    tr = tr.setSelection(TextSelection.create(tr.doc, from))
    view.dispatch(tr)
  }

  return {
    wrap(before, after = before, placeholderText = '') {
      withView((view) => {
        const { empty } = view.state.selection
        const markName = markNameFor(before)

        if (markName) {
          const markType = view.state.schema.marks[markName]
          if (!markType) return
          if (empty) insertMarkedPlaceholder(view, markType, placeholderText)
          else toggleMark(markType)(view.state, view.dispatch)
          view.focus()
          return
        }

        if (before === '[') {
          // 链接：选中 → 加 link mark（href=after 内首段 url）；无选中 → 占位文本+链接
          const url = (after.match(/\((.*?)\)/) ?? [])[1] ?? ''
          const linkType = view.state.schema.marks.link
          if (!linkType) return
          if (empty) {
            const { from } = view.state.selection
            const text = placeholderText || '链接'
            let tr = view.state.tr.insertText(text, from)
            tr = tr.addMark(from, from + text.length, linkType.create({ href: url }))
            tr = tr.setSelection(TextSelection.create(tr.doc, from + text.length))
            view.dispatch(tr)
          } else {
            toggleMark(linkType, { href: url })(view.state, view.dispatch)
          }
          view.focus()
          return
        }

        if (before === '$') {
          // 行内公式：选中 → 替换为 math_inline 节点；无选中 → 插入空公式节点
          const { from, to, empty } = view.state.selection
          const mathInline = view.state.schema.nodes.math_inline
          if (!mathInline) return
          const value = empty
            ? placeholderText || ''
            : view.state.doc.textBetween(from, to)
          let tr = view.state.tr
          if (!empty) tr = tr.delete(from, to)
          const node = mathInline.create({ value })
          tr = tr.insert(tr.selection.from, node)
          tr = tr.setSelection(TextSelection.create(tr.doc, tr.selection.from + 1))
          view.dispatch(tr)
          view.focus()
        }
      })
    },

    block(prefix, _suffix = '', opts = {}) {
      withView((view) => {
        const { state } = view
        const blockMode = opts.block === true

        // ---- 块级：光标处插入多行块 ----
        if (blockMode) {
          // 代码块：prefix 为 ```lang
          if (prefix.startsWith('```')) {
            const lang = prefix.replace(/^`{3,}/, '').trim() || null
            setBlockType(state.schema.nodes.code_block, { language: lang })(
              state,
              view.dispatch,
            )
            view.focus()
            return
          }
          // 公式块 $$：数学块在 Milkdown 中是 code_block + LaTeX 语言（Crepe latex 约定）
          if (prefix === '$$') {
            setBlockType(state.schema.nodes.code_block, { language: 'LaTeX' })(
              state,
              view.dispatch,
            )
            view.focus()
            return
          }
          // 表格：插入 2 列 3 行（表头 + 2 行）
          if (prefix.startsWith('|')) {
            const editor = getEditor()
            if (editor) {
              editor.action((ctx) => {
                const v = ctx.get(editorViewCtx)
                const table = createTable(ctx, 3, 2)
                let tr = v.state.tr.replaceSelectionWith(table)
                tr = tr.setSelection(TextSelection.create(tr.doc, tr.selection.from))
                v.dispatch(tr.scrollIntoView())
              })
            }
            view.focus()
            return
          }
          // 分割线
          if (prefix.includes('---')) {
            const hr = state.schema.nodes.hr.create()
            const tr = state.tr.replaceSelectionWith(hr)
            view.dispatch(tr.scrollIntoView())
            view.focus()
            return
          }
          return
        }

        // ---- 行级：作用于当前块 ----
        // 标题
        const headingMatch = /^(#{1,6})\s$/.exec(prefix)
        if (headingMatch) {
          setBlockType(state.schema.nodes.heading, {
            level: headingMatch[1].length,
          })(state, view.dispatch)
          view.focus()
          return
        }
        // 无序列表
        if (/^[-*+]\s$/.test(prefix)) {
          wrapInList(state.schema.nodes.bullet_list)(state, view.dispatch)
          view.focus()
          return
        }
        // 有序列表
        if (/^\d+[.)]\s$/.test(prefix)) {
          wrapInList(state.schema.nodes.ordered_list)(state, view.dispatch)
          view.focus()
          return
        }
        // 勾选框：包裹为任务列表（checked=false）
        if (prefix === '- [ ] ' || prefix === '- [x] ') {
          const checked = prefix === '- [x] '
          const wrapped = wrapInList(state.schema.nodes.bullet_list)(state)
          if (wrapped) {
            const tr = state.tr
            // 对选中范围的 list_item 设置 checked
            const { from, to } = tr.selection
            tr.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type.name === 'list_item') {
                tr.setNodeMarkup(pos, undefined, {
                  ...node.attrs,
                  checked,
                })
              }
            })
            view.dispatch(tr)
          }
          view.focus()
          return
        }
        // 引用
        if (prefix === '> ') {
          wrapIn(state.schema.nodes.blockquote)(state, view.dispatch)
          view.focus()
        }
      })
    },

    insertImage(path) {
      withView((view) => {
        const { state } = view
        const alt = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? '图片'
        const node = state.schema.nodes.image.create({ src: path, alt })
        const tr = state.tr.replaceSelectionWith(node)
        view.dispatch(tr.scrollIntoView())
        view.focus()
      })
    },

    jumpTo(item) {
      withView((view) => {
        const { doc } = view.state
        let found = false
        doc.descendants((node: PmNode, pos: number) => {
          if (found) return false
          if (
            node.type.name === 'heading' &&
            node.attrs.level === item.level &&
            (node.textContent === item.text ||
              node.textContent.includes(item.text) ||
              item.text.includes(node.textContent))
          ) {
            const sel = TextSelection.create(doc, Math.max(pos + 1, 0))
            view.dispatch(view.state.tr.setSelection(sel).scrollIntoView())
            found = true
            return false
          }
          return true
        })
        view.focus()
      })
    },

    focus() {
      withView((view) => view.focus())
    },
  }
}
