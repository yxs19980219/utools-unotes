// SourceNote preload —— 最小权限桥（预留空壳）
// 规范：CommonJS、源码透明不压缩、只暴露必要能力。
// 本期渲染进程仅依赖 uTools 注入的全局对象，无需自定义 Node 能力，
// 后续如需文件导入/导出等能力，在此按最小权限原则添加。

window.services = {}
