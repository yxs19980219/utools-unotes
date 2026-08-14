/**
 * components/Editor/MilkdownEditor.tsx —— Milkdown 即时渲染编辑器内核（CrepeBuilder 拼装）
 *
 * 任务 08-14-milkdown-editor-migration：以 Milkdown 7.22.1 替换旧 CM6 自研内核
 * （@atomic-editor/editor + markdownDecorations/mathExtension）。
 *
 * 对外契约与旧 AtomicEditor 完全一致（NoteView/MarkdownToolbar/MetaInfoPanel 零改动）：
 * - props：value/onChange/onSave/placeholder/autoFocus/className + forwardRef<MarkdownInsertApi>
 * - documentId：文档身份（父组件 key remount，光标/undo 不串笔记）
 * - readOnly：归档只读（CrepeBuilder setReadonly，勾选框/表格天然不可交互）
 *
 * 装配（CrepeBuilder 已内置 commonmark/gfm/listener/history/indent/trailing/clipboard/upload）：
 * - codeMirror：代码块（复用已安装 @codemirror/lang-*，见 CODE_LANGUAGES）
 * - latex：公式（$…$/$$…$$ 标准语法，KaTeX 渲染，光标进节点显示源码）
 * - placeholder：空文档占位提示
 * - listItem：任务列表勾选框渲染 + 点击 toggle（readonly 下自动禁用）
 * - 自研：==高亮== / <u> 下划线 mark 插件（customMarks）+ Ctrl/Cmd+S keymap
 * 不装配：toolbar（自研 MarkdownToolbar 替代）、block-edit（块拖拽手柄，需求排除）、
 * slash（斜杠命令，需求排除）、top-bar / ai / image-block（维持旧内核行为）。
 *
 * 受控语义：
 * - 输入路径：listener.markdownUpdated 回写 onChange（NoteView 防抖保存不变）
 * - 外部 value 变化：兜底 compare + replaceAll（正常路径 value 恒等于回写值 → no-op）
 */
import { memo, useEffect, useImperativeHandle, useMemo, useRef, forwardRef, useState } from 'react'
import { CrepeBuilder } from '@milkdown/crepe'
import { codeMirror } from '@milkdown/crepe/feature/code-mirror'
import { latex } from '@milkdown/crepe/feature/latex'
import { listItem } from '@milkdown/crepe/feature/list-item'
import { placeholder } from '@milkdown/crepe/feature/placeholder'
import { editorViewCtx } from '@milkdown/kit/core'
import { getMarkdown, replaceAll } from '@milkdown/kit/utils'
import { LanguageDescription } from '@codemirror/language'
import { keymap } from '@milkdown/kit/prose/keymap'
import { $prose } from '@milkdown/kit/utils'

import { cn } from '@/lib/utils'
import {
  createMarkdownInsertApi,
  type MarkdownInsertApi,
} from './markdownInsertApi'
import { customMarks, customMarksStringify } from './plugins/customMarks'
import 'katex/dist/katex.min.css'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/classic.css'
import './milkdownTheme.css'

export type { MarkdownInsertApi } from './markdownInsertApi'

interface MilkdownEditorProps {
  value: string
  onChange(value: string): void
  /** Ctrl/Cmd+S 保存回调（仅编辑器内焦点生效；表单其他输入框由表单 window 监听兜底） */
  onSave?: () => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
  /** 文档身份：变化时重挂载（切笔记），光标/undo 不串文档 */
  documentId: string
  /** 只读（归档）：渲染一致，禁止编辑（CrepeBuilder setReadonly） */
  readOnly?: boolean
}

/** 已安装的 @codemirror/lang-*（围栏语法高亮用；勿引入未安装包） */
const CODE_LANGUAGES: readonly LanguageDescription[] = [
  LanguageDescription.of({
    name: 'JavaScript',
    alias: ['js', 'jsx'],
    extensions: ['js', 'mjs', 'cjs', 'jsx'],
    load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  }),
  LanguageDescription.of({
    name: 'TypeScript',
    alias: ['ts', 'tsx'],
    extensions: ['ts', 'mts', 'cts', 'tsx'],
    load: () =>
      import('@codemirror/lang-javascript').then((m) =>
        m.javascript({ typescript: true, jsx: true }),
      ),
  }),
  LanguageDescription.of({
    name: 'HTML',
    alias: ['htm'],
    extensions: ['html', 'htm'],
    load: () => import('@codemirror/lang-html').then((m) => m.html()),
  }),
  LanguageDescription.of({
    name: 'CSS',
    extensions: ['css'],
    load: () => import('@codemirror/lang-css').then((m) => m.css()),
  }),
  LanguageDescription.of({
    name: 'Markdown',
    alias: ['md'],
    extensions: ['md', 'markdown', 'mkd'],
    load: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  }),
]

/** Ctrl/Cmd+S：保存回调走 ref（keymap 创建后不随渲染重建，回调永远取最新闭包） */
const createSaveKeymap = (onSave: () => void) =>
  $prose(() =>
    keymap({
      'Mod-s': () => {
        onSave()
        return true // 阻断浏览器默认（保存页面等）
      },
    }),
  )

const MilkdownEditor = memo(
  forwardRef<MarkdownInsertApi, MilkdownEditorProps>(function MilkdownEditor(
    {
      value,
      onChange,
      onSave,
      placeholder: placeholderText,
      autoFocus = false,
      className,
      documentId,
      readOnly = false,
    },
    ref,
  ) {
    // saveRef：keymap 创建后不随渲染重建，回调永远取最新闭包
    const saveRef = useRef(onSave)
    saveRef.current = onSave
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const valueRef = useRef(value)
    valueRef.current = value

    const builderRef = useRef<CrepeBuilder | null>(null)
    const rootRef = useRef<HTMLDivElement | null>(null)
    const [ready, setReady] = useState(false)

    // 编辑器生命周期：documentId 变化时销毁重建（父组件 key remount + 本 effect 双保险，
    // 保证光标/undo 不串文档）
    useEffect(() => {
      const root = rootRef.current
      if (!root) return
      const initialValue = valueRef.current
      const save = () => saveRef.current?.()

      const builder = new CrepeBuilder({ root, defaultValue: initialValue })
      builder
        .addFeature(codeMirror, { languages: CODE_LANGUAGES as LanguageDescription[] })
        .addFeature(latex)
        .addFeature(placeholder, { text: placeholderText })
        .addFeature(listItem)

      builder.editor
        .config(customMarksStringify)
        .use(customMarks)
        .use(createSaveKeymap(save))

      if (readOnly) builder.setReadonly(true)

      // 输入回写（markdownUpdated 防抖于框架内部；md 相等不重复回调）
      builder.on((listener) => {
        listener.markdownUpdated((_ctx, md, prev) => {
          if (md !== prev) onChangeRef.current(md)
        })
      })
      builderRef.current = builder
      void builder.create().then(() => {
        if (autoFocus) builder.editor.action((ctx) => ctx.get(editorViewCtx).focus())
        setReady(true)
      })

      return () => {
        builderRef.current = null
        void builder.destroy()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [documentId])

    // 受控兜底：外部 value 变化（理论仅切笔记/草稿重置触发）→ replaceAll。
    // 仅在编辑器创建完成后执行（editorViewCtx 就绪），避免 create 异步期间崩溃。
    useEffect(() => {
      const builder = builderRef.current
      if (!builder || !ready) return
      builder.editor.action((ctx) => {
        const current = getMarkdown()(ctx)
        if (current === valueRef.current) return
        builder.editor.action(replaceAll(valueRef.current))
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, ready])

    const api = useMemo(
      () => createMarkdownInsertApi(() => builderRef.current?.editor ?? null),
      [],
    )
    useImperativeHandle(ref, () => api, [api])

    return <div className={cn('h-full', className)} ref={rootRef} />
  }),
)

export default MilkdownEditor
