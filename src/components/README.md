# src/components —— 界面零件

这里只有「会渲染的东西」，没有业务逻辑、没有 SQL、没有 fetch 业务数据。

```
AppShell.tsx     外壳：侧栏（三段导航 + 收起态）、顶栏、移动端底部 tabbar、右下角 FAB、主题切换、⌘K
ui.tsx           组件库：Card / CardHead / Section / Btn / IconBtn / Badge / Stat / Avatar / Tabs /
                 Segmented / Empty / Skeleton / Modal / Drawer / Confirm / Menu / Field / SearchInput /
                 Switch / Progress / InfoGrid / Toast
icons.tsx        64 个内联 SVG 图标（无图标库，全部手写，stroke 1.8）
SearchPalette.tsx  ⌘K 全局搜索面板
MakeupModal.tsx    一键补课
MicButton.tsx      语音输入（浏览器 SpeechRecognition）
Sparkline.tsx      迷你趋势线
ImportModal.tsx    贴 JSON → 检查 → 确认导入
ApiCard.tsx        设置页「对接与接口」卡（令牌生成、curl 示例）
```

## 用的时候注意

- **按钮没有 `href`**。页面跳转写 `<a className="btn …">` 或 `<Link className="btn …">`，`Btn` 只处理点击。
- `Section` 的 `mt` 是 `boolean`，写 `mt={0}` 会报 TS 错。
- `Stat` 的 `tone` 只有 `ok | warn | bad | violet | cyan`。
- `Toast` 的 API 是 `toast.ok(msg)` / `toast.bad(msg)` / `toast.info(msg)`，不是 `toast(msg, tone)`。
- `Badge` 的 `tone` 除了语义色，还有业务态：`present / leave / absent / makeup / done / planned`。
- `Modal`/`Drawer` 的 `onClose` 必须走 ref 或 `useCallback`——直接依赖内联函数会让整页在输入时反复重渲染（这条踩过，见 AGENTS.md §3）。

## 加组件之前

先确认 `ui.tsx` 里没有能用的。这个项目的规矩是「宁可多写两个 className，也不为一次性需求造组件」。真的有两处以上要用，再加进来，并且保持 props 少而直白。
