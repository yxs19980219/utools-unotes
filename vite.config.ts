import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * stripDevelopmentField —— uTools 插件构建铁律：
 * dev 模式使用 public/plugin.json（含 development.main 指向 vite dev server），
 * build 产物 dist/plugin.json 必须删除 development 字段，否则发布版会尝试连 dev server。
 */
function stripDevelopmentField() {
  return {
    name: 'strip-development-field',
    closeBundle() {
      const p = path.join(process.cwd(), 'dist', 'plugin.json')
      if (!fs.existsSync(p)) return
      const json = JSON.parse(fs.readFileSync(p, 'utf-8'))
      delete json.development
      fs.writeFileSync(p, JSON.stringify(json, null, 2) + '\n', 'utf-8')
    },
  }
}

/**
 * katexWoff2Only —— KaTeX 字体裁剪（AC13 体积优化）：
 * katex.min.css 每个 @font-face 声明 woff2/woff/ttf 三种格式（共 ~1.02MB），
 * Chromium 108+ 全支持 woff2，构建期剔除 woff/ttf 引用 → 只拷贝 woff2（~0.24MB）。
 * 在 vite:css 处理（url 解析/拷贝）之前（enforce: 'pre'）改写源码。
 */
function katexWoff2Only() {
  return {
    name: 'katex-woff2-only',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      if (!id.endsWith('.css') || !id.includes('katex')) return
      // 剔除 woff/ttf 引用（连同其前置逗号），只留 woff2
      return code
        .replace(/,\s*url\(([^)]*\.(?:woff|ttf))\)\s*format\([^)]*\)/g, '')
        .replace(/url\(([^)]*\.(?:woff|ttf))\)\s*format\([^)]*\)\s*,?\s*/g, '')
    },
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  // base: './' —— uTools 以 file:// 协议加载 dist/index.html，资源路径必须相对
  base: './',
  plugins: [react(), tailwindcss(), katexWoff2Only(), stripDevelopmentField()],
  // Lightning CSS：把现代 CSS（oklch/color-mix/@layer/嵌套）自动降级转译，
  // 兼容 uTools 内置的旧 Chromium 内核（Tailwind 4 输出大量 Chrome 111+ 语法，
  // 老内核不认会导致整段样式失效 → 白屏/线框。这是线框问题的根治方案）
  css: {
    transformer: 'lightningcss',
    lightningcss: {
      targets: { chrome: 88 },
    },
  },
  // lightningcss minify 对 Tailwind 4 输出有兼容 bug（Invalid empty selector），
  // 关闭 minify 只保留降级转译（产物略大，功能不受影响）
  build: {
    cssMinify: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
