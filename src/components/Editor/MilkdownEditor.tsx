/**
 * components/Editor/MilkdownEditor.tsx —— Milkdown (Crepe) WYSIWYG 编辑器封装
 *
 * 替代 CodeMirrorEditor：对外契约不变（value/onChange/onSave/placeholder/autoFocus +
 * forwardRef 暴露 MarkdownInsertApi），NoteView 零感知切换。
 *
 * 生命周期自管理（不用 @milkdown/react 的 useEditor/useGetEditor）：
 * - React StrictMode 双挂载（mount → cleanup → mount）下，官方 useGetEditor 存在
 *   create/destroy 竞态（间歇性不渲染）；此处用 disposed 标志 + 实例级 destroy 兜底：
 *   后挂载实例必然生效，先挂载的孤儿实例在 resolve 后自毁
 * - 外部 value 变化（切笔记）→ replaceAll 整文替换；内部编辑回写经 markdownUpdated
 *   去重（lastValueRef），避免受控循环
 * - Ctrl/Cmd+S：view.dom keydown 拦截（编辑器内焦点）
 * - readonly：Crepe setReadonly + 隐藏块手柄等交互痕迹
 */
import { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import { Crepe } from '@milkdown/crepe'
import type { Editor } from '@milkdown/kit/core'
import { editorViewCtx } from '@milkdown/kit/core'
import { replaceAll } from '@milkdown/kit/utils'

import { cn } from '@/lib/utils'
import '@milkdown/crepe/theme/common/style.css'
import './milkdownTheme.css'
import { createMarkdownInsertApi } from './milkdownApi'
import type { MarkdownInsertApi } from './markdownInsertApi'

interface MilkdownEditorProps {
  value: string
  onChange(value: string): void
  /** Ctrl/Cmd+S 保存回调（仅编辑器内焦点生效；表单其他输入框由表单 window 监听兜底） */
  onSave?: () => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
  /** 只读态（归档笔记）：不可编辑，渲染一致 */
  readonly?: boolean
}

const MilkdownEditor = memo(
  forwardRef<MarkdownInsertApi, MilkdownEditorProps>(function MilkdownEditor(props, ref) {
    const { value, onChange, onSave, placeholder, autoFocus = false, className, readonly = false } =
      props

    const containerRef = useRef<HTMLDivElement | null>(null)
    const editorRef = useRef<Editor | null>(null)
    const crepeRef = useRef<Crepe | null>(null)
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const onSaveRef = useRef(onSave)
    onSaveRef.current = onSave
    /** 编辑器最近一次对外回写的 markdown（防受控循环与切换笔记误判） */
    const lastValueRef = useRef(value)

    const initialValue = useRef(value)

    useEffect(() => {
      const container = containerRef.current
      if (!container) return
      const crepe = new Crepe({
        root: container,
        defaultValue: initialValue.current,
        featureConfigs: {
          placeholder: {
            text: placeholder ?? '',
            mode: 'doc',
          },
        },
      })
      crepe.setReadonly(readonly)
      crepeRef.current = crepe

      let disposed = false

      /** Ctrl/Cmd+S：触发保存并拦截浏览器默认行为 */
      const handleKeyDown = (event: KeyboardEvent) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          onSaveRef.current?.()
        }
      }

      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => {
          lastValueRef.current = markdown
          onChangeRef.current(markdown)
        })
        listener.mounted((ctx) => {
          const view = ctx.get(editorViewCtx)
          view.dom.addEventListener('keydown', handleKeyDown)
          if (autoFocus) view.focus()
        })
        listener.destroy((ctx) => {
          const view = ctx.get(editorViewCtx)
          view.dom.removeEventListener('keydown', handleKeyDown)
        })
      })

      void crepe.create().then((editor) => {
        if (disposed) {
          void crepe.destroy()
          return
        }
        editorRef.current = editor
      })

      return () => {
        disposed = true
        editorRef.current = null
        void crepe.destroy()
        crepeRef.current = null
      }
    }, [])

    // 外部 value 变化（切笔记/外部写入）→ 整文替换；与编辑器回写一致时不操作
    useEffect(() => {
      const instance = editorRef.current
      if (!instance) return
      if (value === lastValueRef.current) return
      lastValueRef.current = value
      instance.action(replaceAll(value))
    }, [value])

    const api = useMemo<MarkdownInsertApi>(
      () => createMarkdownInsertApi(() => editorRef.current ?? undefined),
      [],
    )

    useImperativeHandle(ref, () => api, [api])

    return (
      <div className={cn('min-h-0 flex-1 overflow-y-auto', className)}>
        <div ref={containerRef} />
      </div>
    )
  }),
)

export default MilkdownEditor
