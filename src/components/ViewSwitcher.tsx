/**
 * components/ViewSwitcher.tsx —— 侧边栏顶部分段控件（R5）
 *
 * [首页|标签|归档|设置]；归档/设置为二期，置灰不可点（Tooltip 标注）。
 * 用 shadcn Tabs（规则：TabsTrigger 必须包在 TabsList 内）；value 与 ui store 的 view 双向绑定。
 */
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useUiStore, type View } from '@/stores/ui'

const VIEWS: { value: View; label: string; disabled?: boolean }[] = [
  { value: 'home', label: '首页' },
  { value: 'tags', label: '标签' },
  { value: 'archived', label: '归档', disabled: true },
  { value: 'settings', label: '设置', disabled: true },
]

export default function ViewSwitcher() {
  const view = useUiStore((s) => s.view)
  const setView = useUiStore((s) => s.setView)

  return (
    <Tabs
      value={view}
      onValueChange={(v) => setView(v as View)}
      className="w-full gap-1"
    >
      <TabsList className="w-full">
        {VIEWS.map((v) => {
          const trigger = (
            <TabsTrigger
              key={v.value}
              value={v.value}
              disabled={v.disabled}
              className="h-7 px-1 text-[0.8rem]"
            >
              {v.label}
            </TabsTrigger>
          )
          return v.disabled ? (
            <Tooltip key={v.value}>
              <TooltipTrigger asChild>{trigger}</TooltipTrigger>
              <TooltipContent side="bottom">二期开放</TooltipContent>
            </Tooltip>
          ) : (
            trigger
          )
        })}
      </TabsList>
    </Tabs>
  )
}
