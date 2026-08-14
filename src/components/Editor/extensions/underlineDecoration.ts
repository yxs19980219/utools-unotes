/**
 * components/Editor/extensions/underlineDecoration.ts —— 自研 <u>下划线</u> 即时渲染
 *
 * 任务 08-14-editor-cm6-research（D4）：atomic-editor 不支持 `<u>` 下划线（README 仅
 * 列出 bold/italic/strikethrough/inline code），故自研轻量装饰。与 mathExtension 不同，
 * 这是「隐藏标签 + 加样式」的 inline mark 装饰（非 Widget）：
 * - `<u>` / `</u>` 标签用 Decoration.replace({}) 恒隐藏（含光标行，完全所见即所得）
 * - 内容区间用 Decoration.mark 加 `cm-underline`（CSS text-decoration: underline）
 * - 源码保留 `<u>x</u>` 原文，round-trip 字节级一致（纯视图装饰）
 *
 * 任务 08-14-editor-render-polish-2（R6）：由「光标行揭示源码」改为「恒隐藏标签」——
 * 对齐引用 `>` 恒隐藏契约。删除下划线靠工具栏/快捷键 toggle（MarkdownInsertApi.toggleInline），
 * 不依赖手动删标签。
 */
import { RangeSetBuilder } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

/** 单行 `<u>…</u>`（内容不含 `<`）；markdownInsertApi.ts 的 toggle 复用同一正则 */
export const UNDERLINE_RE = /<u>([^<]*?)<\/u>/g

function buildUnderlineDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const text = view.state.doc.toString()

  UNDERLINE_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = UNDERLINE_RE.exec(text)) !== null) {
    const from = m.index
    const to = from + m[0].length
    const contentFrom = from + '<u>'.length
    const contentTo = to - '</u>'.length
    builder.add(from, contentFrom, Decoration.replace({}))
    builder.add(contentFrom, contentTo, Decoration.mark({ class: 'cm-underline' }))
    builder.add(contentTo, to, Decoration.replace({}))
  }
  return builder.finish()
}

/** <u>下划线</u> 即时渲染扩展（标签恒隐藏，内容恒加下划线） */
export const underlineExtension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildUnderlineDecorations(view)
    }

    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = buildUnderlineDecorations(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations },
)
