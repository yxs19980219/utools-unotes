/**
 * components/Editor/milkdownApi.ts —— MarkdownInsertApi 的 Milkdown (Crepe) 实现
 *
 * 语义映射（WYSIWYG 块转换优先，源码插入兜底）：
 * - wrap：markdown 文本插入（strong/emphasis/strike/code/link/math 由 remark 解析成节点；
 *   == 高亮无 schema 保留源码文本；<u> 由 html 节点渲染）
 * - 行级：heading/ul/ol/quote 用块转换命令；task 用 bullet list + checked 属性
 * - 块级：代码块/公式块插入 markdown（remark 解析成对应节点）；表格/分割线用命令
 */
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import { callCommand, insert } from '@milkdown/kit/utils'
import { TextSelection } from '@milkdown/kit/prose/state'
import {
  wrapInHeadingCommand,
  wrapInBulletListCommand,
  wrapInOrderedListCommand,
  wrapInBlockquoteCommand,
  insertHrCommand,
  insertImageCommand,
} from '@milkdown/kit/preset/commonmark'
import { insertTableCommand } from '@milkdown/kit/preset/gfm'
import type { MarkdownInsertApi } from './markdownInsertApi'

/** 行级命令：heading 级别 */
const HEADING_LEVEL: Record<string, number> = { '# ': 1, '## ': 2, '### ': 3 }

/** 当前光标是否位于任务列表项内（checked 属性存在即任务项） */
function cursorInTaskItem(editor: Editor): boolean {
  let inTask = false
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const $pos = view.state.selection.$from
    for (let depth = $pos.depth; depth >= 0; depth -= 1) {
      if ($pos.node(depth).type.name === 'list_item' && $pos.node(depth).attrs.checked != null) {
        inTask = true
        return
      }
    }
  })
  return inTask
}

/** 把光标所在块转换为任务列表项（checked=false） */
function wrapInTaskList(editor: Editor): void {
  editor.action(callCommand(wrapInBulletListCommand.key))
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const $pos = view.state.selection.$from
    for (let depth = $pos.depth; depth >= 0; depth -= 1) {
      const node = $pos.node(depth)
      if (node.type.name === 'list_item') {
        view.dispatch(
          view.state.tr.setNodeMarkup($pos.before(depth), undefined, {
            ...node.attrs,
            checked: false,
          }),
        )
        return
      }
    }
  })
}

export function createMarkdownInsertApi(getEditor: () => Editor | undefined): MarkdownInsertApi {
  return {
    wrap(before, after = before, placeholderText = '') {
      const editor = getEditor()
      if (!editor) return
      let text = ''
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const { from, to } = view.state.selection
        const sel = view.state.doc.textBetween(from, to, '\n')
        text = sel ? before + sel + after : before + placeholderText + after
      })
      if (!text) return
      editor.action(insert(text))
      editor.action((ctx) => ctx.get(editorViewCtx).focus())
    },

    block(prefix, _suffix = '', opts = {}) {
      const editor = getEditor()
      if (!editor) return

      if (opts.block) {
        // 块级：按模板语义插入
        if (prefix.startsWith('```')) {
          editor.action(insert('```ts\n\n```'))
        } else if (prefix.trim() === '$$') {
          // Crepe 公式块 = 语言 LaTeX 的代码块（内置 KaTeX 预览）
          editor.action(insert('```LaTeX\n\n```'))
        } else if (prefix.includes('|')) {
          editor.action(callCommand(insertTableCommand.key, { row: 3, col: 2 }))
        } else if (prefix.includes('---')) {
          editor.action(callCommand(insertHrCommand.key))
        } else {
          editor.action(insert(prefix))
        }
        editor.action((ctx) => ctx.get(editorViewCtx).focus())
        return
      }

      // 行级
      const level = HEADING_LEVEL[prefix]
      if (level) {
        editor.action(callCommand(wrapInHeadingCommand.key, level))
      } else if (prefix === '- ') {
        editor.action(callCommand(wrapInBulletListCommand.key))
      } else if (prefix === '1. ') {
        editor.action(callCommand(wrapInOrderedListCommand.key))
      } else if (prefix === '- [ ] ') {
        if (!cursorInTaskItem(editor)) wrapInTaskList(editor)
      } else if (prefix === '> ') {
        editor.action(callCommand(wrapInBlockquoteCommand.key))
      }
      editor.action((ctx) => ctx.get(editorViewCtx).focus())
    },

    insertImage(path) {
      const editor = getEditor()
      if (!editor) return
      const alt = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? '图片'
      editor.action(callCommand(insertImageCommand.key, { src: path, alt }))
      editor.action((ctx) => ctx.get(editorViewCtx).focus())
    },

    jumpTo(index) {
      const editor = getEditor()
      if (!editor) return
      editor.action((ctx) => {
        const view = ctx.get(editorViewCtx)
        const doc = view.state.doc
        let headingPos = -1
        let seen = 0
        doc.descendants((node, pos) => {
          if (node.type.name === 'heading') {
            if (seen === index) {
              headingPos = pos
              return false
            }
            seen += 1
          }
          return true
        })
        if (headingPos < 0) return
        view.dispatch(
          view.state.tr
            .setSelection(TextSelection.near(doc.resolve(headingPos + 1)))
            .scrollIntoView(),
        )
        view.focus()
      })
    },

    focus() {
      const editor = getEditor()
      if (!editor) return
      editor.action((ctx) => ctx.get(editorViewCtx).focus())
    },
  }
}
