/**
 * components/ViewSwitcher.tsx —— 侧边栏顶部分段控件（R5）
 *
 * [首页|标签|归档|设置]；二期已放开（归档/设置视图）。
 * 用 shadcn Tabs（规则：TabsTrigger 必须包在 TabsList 内）；value 与 ui store 的 view 双向绑定。
 * 路由切换直接调用（实时保存时代无确认）。
 */
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useUiStore, type View } from '@/stores/ui'

const VIEWS: { value: View; label: string }[] = [
  { value: 'home', label: '首页' },
  { value: 'tags', label: '标签' },
  { value: 'archived', label: '归档' },
  { value: 'settings', label: '设置' },
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
        {VIEWS.map((v) => (
          <TabsTrigger
            key={v.value}
            value={v.value}
            className="h-7 px-1 text-[0.8rem]"
          >
            {v.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
