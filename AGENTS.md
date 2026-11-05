# AGENTS.md — 这个项目的铁律

给未来的自己（和 AI 助手）看的。改代码前先读完这 9 条。

## 1. 技术栈是固定的，不要升级换代

- Next.js 15 App Router + React 19 + TypeScript
- SQLite（`better-sqlite3`，同步 API）
- 手写 CSS（`src/app/globals.css`）

**不要引入**：ORM（Prisma/Drizzle）、Tailwind、UI 组件库、状态管理库、Redis、Postgres、Docker。
理由：一个老师几十个学生，QPS 个位数；依赖越少，AI 越改得动，你越放得下。

## 2. 数据库就是唯一真相，建表不用迁移工具

- 表结构只写在 `src/db/ddl.ts`（`CREATE TABLE IF NOT EXISTS`），启动时自动执行。
- 改字段的完整动作：改 `ddl.ts` → 改 `src/db/types.ts` 的 interface → 改用到的 SQL。
- 三个地方必须同时改，少一个就会报类型错或运行时错。
- 已有数据库加字段走 `src/db/index.ts` 的 `ensureColumn(db, 表, 字段, 定义)`（内部用 `PRAGMA table_info` 判断后 `ALTER TABLE`），这样空库和老库都能起来。新增字段同时写进 `ddl.ts`。
- 索引也是幂等的：在 `index.ts` 里写 `CREATE INDEX IF NOT EXISTS`。

## 3. 课时只走流水账，禁止余额字段

- 余额 = `SUM(hours_ledger.delta_minutes)`，视图 `v_student_balance` 算。
- 永远不要加 `student.balance` 这种字段——一旦有了它，就一定会和流水对不上。
- 加课时/扣课时都要写一条 `hours_ledger`，时间戳由 SQLite 写。
- 收学费（`payment`）必须和一条 `kind='purchase'` 的流水在同一个事务里，`ref_id` 存 payment 的 id；撤销收款就把那条流水一起删。

## 4. 学情记录只追加，不修改

- `note` 表只 `INSERT`，不给编辑、不给删除（除非学生彻底删号）。
- 理由：这些是生成家长周报的原料，改了就没法追溯「当时是怎么判断的」。
- 生成家长反馈（`feedback`）只是把 note 拼成人话，草稿可改、发出后可标记 `sent`，但原料 note 不动。

## 5. 时间一律本地时间字符串

- 格式固定：`YYYY-MM-DD`、`YYYY-MM-DD HH:mm`（`src/lib/dates.ts` 里的函数）。
- 不要用 UTC、不要用时间戳整数。SQLite 里就存文本，`datetime('now','localtime')`。
- 排序直接用字符串比较（这个格式天然有序）。

## 6. 页面全是客户端渲染

- 每个页面 `"use client"`，用 `useEffect` + `fetch` 取数。
- 每个 API route 必须有 `export const dynamic = "force-dynamic"`。
- 理由：构建阶段（`next build`）绝不能连数据库；数据库只在进程运行时打开。
- 不要在 Server Component 里直接 `get/all/run`；`layout.tsx` 也不许读库。
- 需要在页面初始化时读查询参数（`?new=1&student=3`）时，用 `window.location.search`，别用 `useSearchParams()`（它会要求 Suspense 边界，构建更容易炸）。

## 7. 改完必须过三关

```powershell
pnpm typecheck     # tsc --noEmit
pnpm build         # next build
pnpm start         # 启动，手动点一遍改过的地方
```

`better-sqlite3` 是原生模块，`next.config.ts` 里的 `serverExternalPackages` 不能删。

本机跑命令的坑：PATH 首位是桌面端自带的 Electron（ABI 148），真 Node 是 `C:\Program Files\nodejs\node.exe`（ABI 137）。原生模块只能被真 Node 加载，所以命令行一律这样写：

```powershell
& "C:\Program Files\nodejs\node.exe" node_modules\next\dist\bin\next build
& "C:\Program Files\nodejs\node.exe" node_modules\typescript\bin\tsc --noEmit
```

## 8. 代码规模：不设上限，但要守住「可读」

**这条原来有个 13000 行预算，2026-11-04 按用户要求解除了。** 现在没有硬上限，加功能不用先算行数。

但解除上限不等于放弃秩序，下面这些仍然算铁律：

- **一个文件只干一件事**。页面超过 600 行就该把子块抽成组件（`src/components/`），别让一个 page.tsx 长成两千行。
- **能不新建表就不新建**。加功能先问：现有 13 张表 + 2 视图能不能拼出来？统计页就是纯聚合、没有新表。
- **重复的逻辑抽到 `src/lib/`**，别在三个路由里各写一份（冲突检测、备份、扣课时都抽过一遍了，别再退回原样）。
- **必须形成套路**：新页面 = `"use client"` + `useEffect` 拉接口 + 复用 `ui.tsx` 的组件 + 只用 `globals.css` 的类；新接口 = `force-dynamic` + `{error}` 报错约定 + 必要时 `tx()`。
- **文档和测试不许省**。加功能就同步改 `README.md` 的用法、必要时补 `tests/` 与 `scripts/smoke*.mjs`。
- 每加完一批，跑一遍 `tsc` + `build` + 冒烟；行数只是报个数，不进决策。


## 9. 备份：自动的，别只靠手动

- 数据库在 `E:\after-school\data\app.db`（另有 `-wal`、`-shm` 两个伴生文件）。
- **每天第一次打开系统时自动备份一次**（`src/lib/backup.ts` 的 `ensureDailyBackup()`，挂在 `/api/dashboard` 上，10 分钟节流），存到 `E:\after-school\backups\auto-YYYY-MM-DD-HHmm.db`，只保留最近 30 份，更老的自删。所以不用再记得手动备份。
- 设置页「数据」区能看到备份列表、点「立即备份」生成 `manual-…db`，点某一行的下载就能拿走（`/api/backup?file=名字`，文件名走白名单校验，挡 `../`）。
- **删掉某一份**：`DELETE /api/backup?file=名字` → `removeBackup(name)`（同样是白名单校验 → `rmSync` → 顺带清 `-wal`/`-shm` → 返回 `{removed,left,freed}`）。前端每行一个 🗑 + 一个 danger 确认框；删的只是 `backups\` 里的快照，绝不动 `data\app.db`。
- 服务在跑也能备份：走的是 SQLite 在线备份 API（`sqlite().backup()`），不是复制文件，所以不会拿到半个事务。
- 恢复：停服务 → 把要用的那份改名成 `app.db` → 放回 `data\`（先删掉旧的 `-wal`/`-shm`）→ 启动。
- 这个库不大（几十个学生，几 MB），丢了就是几个月的记录，**别省这一步**。
- 本机目前**没装 git**（`git` 命令不存在），所以备份就是唯一的后悔药。哪天装了 git，第一时间 `git init` 并提交一次当前状态，之后每改完一个功能提交一次。

---

## 项目结构与职责

```
src/
  app/
    layout.tsx               外壳：ToastProvider + AppShell（不读库）
    globals.css              全部样式（设计 token + 布局 + 组件类，见文末）
    page.tsx                 今日：到点没记提醒 / 今天的课 / 待补课 / 课时不足 / 最近记录
    calendar/page.tsx        课表：周视图 + 月视图，点空位直接排课，可选教案
    calendar/print/page.tsx  课表打印：一页一周，按天列出时间/课程/学生/教室，直接另存 PDF
    students/page.tsx        学生列表：搜索 + 在读/课时不足/全部/已离开 + 表格/卡片
    students/[id]/page.tsx   学生档案：5 个 Tab（概览/学情/课时/上课记录/交费）+ 5 个弹窗
    lessons/[id]/page.tsx    记一笔（核心操作）：每人四态出勤 + 一句话 + 这节课的教案
    lessons/[id]/wrap/page.tsx  跟家长说一句（下课收尾）：上课内容从教案带来，每人说一句 → 出反馈草稿
    feedback/page.tsx        家长反馈：选学生+周期 → 生成草稿 → 改 → 复制发微信 → 标记已发
    plans/page.tsx           备课：教案库，按课程/关键词筛，可挂到排课上
    finance/page.tsx         收支：每月收款、6 个月趋势、收款明细（可撤销）
    stats/page.tsx           统计：收款/课次/消课/出勤率/课程占比/上课最多的学生/半年热力图
    monthly/page.tsx         月报：按孩子看这个月上了几节/缺几次/扣多少课时/交多少/还剩多少 + CSV/打印
    records/page.tsx         上课记录：按日期/学生/课程/状态/出勤筛「一节课一个学生」的流水，可导出
    classes/page.tsx         班级：固定班 + 一键生成下周课表
    students/[id]/statement/page.tsx  上课对账单：某个月上了几次、扣多少课时、交多少费、剩多少 + 给家长的话
    settings/page.tsx        设置：机构信息、默认值、反馈语气、自动备份与恢复、导出 JSON / CSV、AI 开关、对接与接口
    manual/page.tsx          使用说明：内置手册 20 章（正文在 lib/manual.ts），左目录滚动高亮、能打印存 PDF
    docs/page.tsx            接口文档：/api/v1 一览 + 令牌怎么带 + 可抄的 curl / JS / Python 示例
    share/[id]/page.tsx      孩子的小档案：家长只读页（无侧栏顶栏），剩几课时/下次上课/本月三个数/最近小结
    docs/page.tsx            接口文档（/docs）：/api/v1 一览 + 能直接抄的 curl / JS / Python
    share/[id]/page.tsx      家长只读页：剩余课时 / 下次课 / 最近小结 / 最近上课（不含电话与金额，AppShell 对它提前 return 去掉导航）
    api/...                  44 个接口文件（含 /api/v1 开放接口、/api/share、/api/restore、/api/token、/api/health、/api/reports/monthly）
  components/
    AppShell.tsx             侧栏三段导航 + 移动端底部 tabbar + 顶栏（搜索/主题/角标）
    ui.tsx                   通用组件：Card/Btn/Badge/Stat/Tabs/Modal/Drawer/Confirm/Menu/Field…
    icons.tsx                63 个内联 SVG 图标
    SearchPalette.tsx        全局搜索面板（⌘K / Ctrl+K）
    MakeupModal.tsx          一键排补课（生成 status='makeup' 的课）
    MicButton.tsx            语音输入小按钮（浏览器 SpeechRecognition）
    Sparkline.tsx            纯 SVG 迷你趋势线（今日页收款走势用）
    ImportModal.tsx          贴 JSON → 先试算（dryRun）→ 再确认导入，备课/班级/学生共用
    ApiCard.tsx              设置页「对接与接口」卡：令牌生成/换新/关闭 + curl 示例
  db/
    ddl.ts                   建表语句（唯一真相）
    types.ts                 表行类型（唯一真相）
    index.ts                 连接 + all/get/run/tx/setting + ensureColumn + 索引
  lib/
    dates.ts                 时间格式与计算
    scheduling.ts            冲突检测（起止时间是否重叠，纯函数）
    conflicts.ts             查库版冲突检测（排课、改期、冲突预检共用）
    hours.ts                 课时计算的纯函数（扣多少、够不够、谁待补）
    format.ts                展示格式化：money/durationText/relTime/中文枚举表/WEEKDAYS
    report.ts                家长反馈草稿的生成规则（纯函数，不联网）
    feedbackGen.ts           按学生+周期查库拼出草稿（单人页与批量共用这一份）
    lessonFeedback.ts        按「一节课 + 一个学生 + 一句点评」拼草稿（下课收尾页用，纯查库+拼装）
    ai.ts                    AI 润色：读 setting 里的配置调 OpenAI 兼容接口，失败返回 null
    backup.ts                在线备份 + 保留 30 份 + 每天一次
    speech.ts                语音识别 hook（不联网上传，识别结果只填输入框）
    markdown.ts              极简 Markdown → HTML（先整体转义再看记号，教案预览与列表摘要共用）
    csv.ts                   导出用：toCsv（带 BOM）+ fileResponse（中文文件名走 RFC 5987）
    client.ts                前端 fetch 封装
    http.ts                  接口统一返回/报错（JSON 一律带 charset=utf-8）
    version.ts               版本号（/api/health、/api/version 与界面共用一份）
    token.ts                 令牌解析与定时比较（纯函数，有单测）
    apikeys.ts               对接令牌的存/取/换/关 + guard() 守卫
    restore.ts               从备份恢复：先校验表数 → 存一份恢复前快照 → 换文件 → 重开连接
    tone.ts                  读 setting 的 feedback_tone（反馈语气）
    autoNew.ts               useAutoNew(setOpen)：页面带 ?new=1 时自动打开新建弹窗
    share.ts                 家长分享链接的 HMAC 令牌（share_secret + student:id）
    manual.ts                内置使用说明的正文（MANUAL 数组 → MANUAL_TOC 自动派生；改功能要同步改这里）
tests/
  hours.test.ts              课时规则 10 个用例（node --test 直接跑）
  scheduling.test.ts         冲突规则 6 个用例
  report.test.ts             反馈话术 16 个用例（教案要点摘取 + 单节课草稿 + 三种语气）
  token.test.ts              令牌解析 8 个用例
public/
  manifest.json              PWA 清单
  sw.js                      最小 service worker：只为可安装，不缓存任何数据
scripts/
  smoke2.mjs                 33 项接口冒烟测试（node scripts/smoke2.mjs http://127.0.0.1:3312）
  smoke3.mjs                 新功能冒烟：补课/搜索/热力图/sw.js
  smoke4.mjs                 新功能冒烟：批量反馈/拖拽改期/该联系家长
  smoke5.mjs                 新功能冒烟：自动备份/知识点/冲突预检/AI 回退（34 项）
  smoke6.mjs                 新功能冒烟：重复排课/对账单/JSON 导出/收款趋势（30 项）
  smoke7.mjs                 新功能冒烟：下课收尾页/教案要点进反馈/草稿覆盖（30 项）
  smoke8.mjs                 新功能冒烟：导出各 scope/导入 dryRun 与真导入/重名跳过/AI 初稿回退（46 项）
  smoke9.mjs                 新功能冒烟：上课记录筛选与汇总/记录导出/课表打印页/课表接口字段（33 项）
  smoke10.mjs                对接接口 + 恢复：health/version/令牌校验/summary/students/notes/lessons/恢复备份（43 项）
  smoke11.mjs                分享链接 + 反馈语气：HMAC 校验/家长页字段/语气切换影响草稿（24 项）
  smoke12.mjs                月报：月份校验/上月聚合口径/出勤率/CSV 带 BOM/页面 200（34 项）
  smoke13.mjs                删备份（合规名/真删掉/重复删 400/`../` 被拒）＋ 家长页「本月小结」与「下次上课」时区（36 项）
  cdp-err.mjs                排查用：Headless Edge 里抓 Runtime.exceptionThrown，白屏时看真栈（node scripts/cdp-err.mjs <url>）
  evaljs.mjs                 在无头浏览器里跑一段 JS 并打印返回值（量高度/看 computed style 用；表达式带引号就写成文件传 @文件）
  seed-demo.mjs              往空库灌演示数据（3 学生 / 2 课 / 6 节课 / 4 条学情 / 1 节已记完），顺手打印家长分享链接
  shot.mjs                   给几个页面拍照（CDP Page.captureScreenshot，可指定宽高，移动端也拍；SHOT_SHARE 可换分享页链接）
  package.ps1                打包成桌面软件：build → 装运行期依赖 → 塞 native 模块 + node.exe → csc 编启动器 → dist\
  ui-check.mjs               真实浏览器点击检查（Edge headless + CDP，79 项：建学生/建课排课/记一笔/收尾页/搜索/备课/逐页渲染/更多菜单与发给家长/手机浮动按钮/设置页恢复确认/删备份确认/家长分享页/月报页/使用说明目录与打印/侧边栏收起展开/作者署名/控制台无报错）
  ui-check.ps1               跑上面那个：清空测试库 → 起服务 → 点一遍 → 停服务（powershell -File scripts\ui-check.ps1）
启动相关/
  启动.bat                    双击这个（纯 ASCII，只负责转调 ps1）
  start.ps1                   找 Node → 找空端口 → 起服务；已在跑就直接开浏览器
  open-when-ready.ps1         轮询端口，服务真的通了再开浏览器（不要再改回固定 sleep）
```

## 数据表（13 张 + 2 个视图）

| 表 | 作用 | 关键约定 |
| --- | --- | --- |
| `student` | 学生档案 | 软删 `status='left'`；`tags` 是逗号分隔的标签 |
| `course` | 课程科目 | `default_minutes`、`price_per_lesson` |
| `class_group` | 固定班 | `weekday` 0-6、`start_time` `HH:mm` |
| `enrollment` | 班与学生的关系 | 整份替换，不做增量 |
| `lesson` | 一节课 | `start_at` `YYYY-MM-DD HH:mm`；`status` planned/done/cancelled/makeup；`plan_id` 挂教案 |
| `lesson_student` | 一节课的学生名单 | |
| `attendance` | 出勤明细 | `status` present/leave/absent/makeup；`billed_minutes` 是实扣 |
| `hours_ledger` | 课时流水（唯一账本） | `delta_minutes` 正负；`kind` purchase/gift/adjust/refund/consume |
| `note` | 学情记录 | 只追加；`kind` progress/homework/behavior/parent；`level` 1-4 |
| `feedback` | 家长反馈 | `status` draft/sent，发出时写 `sent_at` |
| `payment` | 收款 | 一条收款 = 一条 purchase 流水 |
| `teach_plan` | 教案 | `title`+`content` 必填；`tags` 逗号分隔 |
| `setting` | 键值配置 | org_name / org_phone / teacher_name / org_address / lesson_default_minutes / low_balance_minutes / week_start / ai_enabled / ai_base / ai_model / ai_key |

视图：`v_student_balance`（余额 = SUM(delta_minutes)）、`v_makeup_pending`（请过假、之后没补课的学生）。

## 已经定好的接口约定

- 报错统一 `{ error: "中文说明" }` + 合适的 HTTP 状态码。
- 冲突返回 409，body 里带 `conflicts` 数组；前端问一句「仍然保存吗」，确认后带 `force: true` 重发。
- `done` 状态的课不允许改、不允许删（已产生流水），要改只能手动调整流水。
- 学生删除是软删（`status='left'`），历史账目全部保留。
- 统计类接口（`/api/stats`、`/api/dashboard`）一律当场聚合，**不落统计表**。

## 样式约定（改 UI 前看一眼）

`globals.css` 是这套 UI 的唯一来源，分 24 个区：token / 重置 / 布局骨架 / 排版工具 / 卡片 / 统计 / 按钮 / 表单 / 表格 / 徽章 / Tabs / 列表 / 时间线 / 状态块 / 弹窗菜单 / 周月历 / 图表 / 业务组件 / 响应式 / 全局搜索 / 语音输入 / 打印 / 热力图 / 深色模式。

- 颜色只用 CSS 变量（`--brand` `--ink-2` `--line` `--ok` `--warn` `--bad` `--violet` `--cyan`），不要在页面里写死色值。
- 组件类优先复用：`.card` `.stat` `.btn` `.badge` `.table` `.list-row` `.timeline` `.bars` `.progress` `.heat`。
- 断点只有三个：1180px、980px（侧栏变抽屉、底部 tabbar 出现、周历单列）、720px（全单列）。
- 改完样式必须重新 `pnpm build` 再看效果——`next start` 读的是构建产物，改 CSS 不重建等于没改。
- **深色模式**靠 `:root[data-theme="dark"]` 覆盖 token，页面里别再写第二套颜色；新增组件如果用了写死的白/黑，记得在深色块里补一条。
- **打印**：`@media print` 已隐藏侧栏/顶栏/tabbar 和所有 `.btn`；要打印标题就放一个 `.print-head`（默认 `display:none`，打印时才出现）。

## 10. 新功能三件套：搜索、语音、深浅色

- 新加「能被找出来的东西」时，顺手在 `src/app/api/search/route.ts` 里加一段查询，`SearchPalette` 的 `toItems()` 里加一个分组，否则等于没做（上一版的 `/api/search` 就白躺了半个月）。
- 语音输入只用浏览器内置 `SpeechRecognition`（`src/lib/speech.ts` + `<MicButton>`），**不要引入 whisper 或云端语音**：几十个学生的机构不值得为此联网、传录音、付额度。识别结果只填进输入框，用户可以改。
- 任何新页面都自动继承深浅色和打印，只要不写死颜色、不用固定像素宽。
- **重复排课**：`POST /api/lessons` 带 `repeatWeeks`（1~26），后端把开始时间按「+7 天」展开成一串，冲突一起汇总再 409（文案只列前 4 处），前端 confirm 后带 `force:true` 重发。别在前端循环调接口——那样撞课提示会弹 N 次。
- **教案正文是 Markdown**，渲染一律走 `src/lib/markdown.ts`（先整体转义 HTML 再解析记号，所以贴进 `<script>` 只会显示成文字），不要为此引入 markdown 库。
- **对账单里的单价是反推出来的**（历次交费金额 ÷ 小时数），只用来估算「这个月上的课值多少钱」，**不要拿它当收费依据**，也不要在别处复用它算钱。
- **`/api/export` 的表名是写死的白名单**，不要改成从请求里读表名拼 SQL——那是注入。

## 11. 启动脚本两个坑（都踩过）

- **开浏览器不能固定 sleep**。`next start` 从 3 秒到 12 秒都可能（机器越慢、页面越多越慢），固定等 3 秒就会打开一个「无法访问此网站」，用户以为整个系统坏了。现在由 `open-when-ready.ps1` 轮询端口，通了才开浏览器。改启动流程时不要退回去。
- **`.ps1` 必须存成 UTF-8 with BOM**。Windows PowerShell 5.1（就是双击 .bat 调起来的那个）对无 BOM 的 UTF-8 会按 GBK 读，中文注释直接变乱码、甚至解析失败。而编辑工具保存时会把 BOM 吃掉，所以每次改完 `start.ps1` / `open-when-ready.ps1` 都要补：
  ```powershell
  $p = "E:\after-school\start.ps1"
  $t = [System.IO.File]::ReadAllText($p, [System.Text.UTF8Encoding]::new($false))
  [System.IO.File]::WriteAllText($p, $t, [System.Text.UTF8Encoding]::new($true))
  [System.IO.File]::ReadAllBytes($p)[0..2]   # 应该是 EF BB BF
  ```
- `启动.bat` 保持**纯 ASCII**（只写英文和 `%~dp0`），中文交给 ps1 输出。

## 12. 反馈与提醒的口径

- 反馈草稿的原料只有两样：`note` 和 `attendance`。所以「记一笔」页的一句话比任何 AI 都重要——别为了省事跳过。
- `generateDraft(studentId, from, to)`（`src/lib/feedbackGen.ts`）是单人页和批量按钮**共用的同一个函数**，改规则只改这一处。
- 批量生成会跳过「同一学生+同一周期+已有草稿」的，重复点不会灌一堆重复草稿。
- 今日页的「该跟家长说句话了」= 在读学生里 **14 天没有 note** 的（`/api/dashboard` 的 `staleStudents`），这是提醒，不是自动发消息——发不发还是人来点。
- **「跟家长说一句」（`/lessons/[id]/wrap`）是下课后的主流程**：`finish` 成功后直接 `router.push` 过去，让老师趁记得赶紧说两句。别把它改成「另一个可选入口」。
- 这个页面里的「上课内容」**只能来自教案**（`planPoints(lesson.plan_id → teach_plan.content)`），**绝不再问老师一遍「今天讲了什么」**——这是整套工作流存在的理由。没有挂教案时才退回到「课程名/课程标题」，并在页面上提示去 `/plans` 补一篇。
- 草稿按「学生 + 那一天（`period_start = period_end` = 这节课的日期）」去重：`POST /api/feedback` 已经有 `status='draft'` 的就 update 内容，不会堆重复草稿。**改这块别退化成纯 insert。**
- 收尾页重新打开时会把已存在的草稿回填到 textarea（`draft`/`draft_id` 由 `GET /api/lessons/[id]/feedback` 带回），这条别丢——用户会关掉网页过一会儿再来改。

## 13. 有测试，改课时/冲突规则必须跑

```powershell
& "C:\Program Files\nodejs\node.exe" --test tests/hours.test.ts tests/scheduling.test.ts tests/report.test.ts
```
现在 28 个用例全过（课时 10、冲突 6、反馈话术 12）。这几个文件测的是「扣多少课时」「两个时间段算不算撞」「这段话说得对不对」——系统里最容易算错、错了最伤人的三件事。
- 纯函数在 `src/lib/hours.ts`、`src/lib/scheduling.ts`、`src/lib/report.ts`，**不要在页面或路由里再抄一遍规则**；`finish` 路由扣课时也走 `billedMinutes()`。
- `report.test.ts` 盯两件容易退化的事：`planPoints` 摘要点时不许把一级大标题重复带进正文、请假/缺席/余额不足这几种说法必须还在。
- `node --test` 必须点名文件（`node --test tests/` 会 MODULE_NOT_FOUND），`package.json` 里的 `pnpm test` 就是这条命令。
- 业务上要改扣课规则（比如请假到底扣不扣），先改测试再改代码。

## 14. 知识点掌握度：只汇总，不预测

- 数据来自「记一笔」时填的 `note.topic` + `note.level`（1 需加强 / 2 一般 / 3 良好 / 4 优秀）。没填知识点就不进统计算，别去猜。
- 学生详情「知识点」Tab 展示的是**每人每知识点的平均分 + 最近几次趋势**（`/api/students/[id]` 里的 `topics` 聚合，`avg_level`、`recent_levels`）。
- 说清楚口径：这是**老师自己打的分**的平均，不是 BKT、不是模型推断。页面里已经写明「不替你判断孩子会不会」，改文案时别把它说成 AI 评估。
- 知识点输入有候选（`/api/topics` 按出现次数排），尽量让孩子名字统一，别一个知识点写出三种写法。

## 15. 冲突预检：边填边查

- `GET /api/lessons/conflicts?startAt=2026-11-04 16:30&minutes=90&studentIds=1,2&exclude=3` 返回 `{conflicts:[…]}`，逻辑在 `src/lib/conflicts.ts`（排课 POST、改期 PATCH、预检 GET 三处共用，别各写一份）。
- 排课弹窗里 250ms 防抖自动查，命中就在弹窗底部出黄条提示；**预检只是提示，最终仍由 POST 的 409 + `force` 把关**（预检不可靠的情况：两处同时提交）。
- 课表周视图支持把课拖到别的天（`moveTo()` → `PATCH startAt`），撞了同样走 confirm + `force`。

## 16. AI 润色的边界（别让它编）

- 只在「家长反馈」用：先由 `feedbackGen.ts` 按本地记录拼出草稿，再把草稿交给模型**改语气**；`src/lib/ai.ts` 的 system prompt 明确要求「只能用记录里出现过的事实、数字，不许编造」。
- 配置存在 `setting` 表（`ai_enabled` / `ai_base` / `ai_model` / `ai_key`），设置页可测连接；`ai_enabled=0` 时**完全不发网络请求**，纯本地规则。
- 调用失败/超时（25 秒）一律回退本地草稿，接口返回 `ai:{used:false, reason}`，页面只说一句原因，不挡住流程。**任何新功能都不要让 AI 成为必需路径。**
- 接口必须是 OpenAI 兼容的 `POST {base}/chat/completions`（DeepSeek 用 `https://api.deepseek.com/v1`，本机 Ollama 用 `http://127.0.0.1:11434/v1` + 可留空 key）。

## 17. 三个「看着能用、其实不能用」的坑（都真实发生过）

- **弹窗里的输入框要有对应的写入路径。** 排课弹窗原来用 `newCourse || courses.length === 0` 决定显示输入框，但保存时只判 `newCourse`——一门课都没有的机构，输入框能打字却永远建不出课，只会反复弹「选一门课程」。现在统一成 `const creatingCourse = newCourse || courses.length === 0;`，保存时 `creatingCourse` 就先 `POST /api/courses` 再排课。**加/改表单控件时，先确认它和 submit 用的是同一个判断条件。**
- **Modal / Drawer 的 effect 不许依赖 `onClose`。** 调用方几乎都传内联箭头函数，`useEffect(..., [open, onClose])` 会变成「每敲一个字重跑一次」：cleanup 把 `body.style.overflow` 清空、再设回 `hidden`，Windows 上滚动条一出一进，整页宽度抖动，用户看到的就是「填东西时页面一直闪」。正确写法是 `const closeRef = useRef(onClose); closeRef.current = onClose;` + 依赖 `[open]`。
- **预渲染页面里不许直接 `new Date()` 渲染文本。** 静态预渲染的 HTML 是**构建那一刻**的日期，客户端渲染是**现在**，跨过零点（或构建后过几天）就会撞上 React #418 水合失败，页面局部回退成客户端重绘。日期类文案一律先 `useState("")`、在 `useEffect` 里 `setDateLabel(todayLabel())`（见 `AppShell.tsx`）。同理适用于「几月/第几周/问候语」这类随时钟变化的内容。

## 18. 交付前怎么「模拟点一遍」

接口冒烟（`smoke2~7`，143 项）能证明数据对不对，但证明不了「按钮点得动」。**每次改完前端，两条都要跑**：

```powershell
# 1) 接口冒烟（服务开着即可，如 3319 端口）
node scripts/smoke7.mjs http://127.0.0.1:3319

# 2) 真实浏览器点击（自己会起停服务、自己清测试库）
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ui-check.ps1
```

`ui-check.mjs` 用 Edge headless + CDP 真点：改输入值用原生 setter + `input` 事件触发 React onChange，按钮用 `el.click()`，最后收集 `Runtime.exceptionThrown` / `console.error`——**任何一条报错就算失败**，所以它能抓住水合失败这类「页面看着正常但控制台在报」的问题。

注意 `ui-check` 的排课那一步**假设库里一门课程都没有**（它测的是「没有课程时也能当场建课」这个流程）。跑之前先清空 `data`，否则会因为已有课程直接走下拉框而失败——那不是回归。

## 19. 导入导出：导出给人看，导入只收 JSON

- **导出**统一走 `GET /api/export?scope=all|students|plans|classes|payments|records&format=json|csv`，文件名用 `csv.ts` 的 `stamp()` 打时间戳。
  - `students` / `payments` / `records` 是给人看的表，默认 CSV（带 BOM，Excel 双击不乱码）。
  - `plans` / `classes` 默认 JSON，**因为它们是「能导回去」的格式**，字段名就是导入接口认的字段名。
  - `all` 是 13 张表的全量 JSON（表名走白名单常量，**绝不允许把表名拼进字符串**）。
- **导入**只做 JSON：`POST /api/import {scope, rows, dryRun?, createCourses?}`。CSV 的逗号/换行/引号在中文表格里坑太多，不写解析器——导出 CSV 给人看，导入用 JSON 给程序用。
  - **`dryRun` 默认 true**，前端必须「先检查、再确认」两步：`ImportModal` 的「检查一下」只看计数，用户点了「确认导入」才真写。
  - 试算是靠 `tx()` 里抛 `DryRunRollback` 整体回滚实现的——**回滚不等于不用事务**，别为了试算去查「有没有写过」。
  - 重名一律 `skipped`，**不覆盖已有数据**。用户要改就自己去改，程序不替他做决定。
  - 兼容驼峰/下划线/中文表头（`pick()`），字段缺了给 `errors:[{index,name,reason}]`，不让整批失败。
- **中文文件名必须走 RFC 5987**：`Content-Disposition: attachment; filename="ascii 兜底"; filename*=UTF-8''...`。直接写中文会让 `new Response()` 抛 `TypeError: Cannot convert argument to a ByteString`（HTTP 头只能是 ASCII）。这条同样适用于以后任何下载接口。
- 导出的 JSON 里没有密码类字段，也不含 `setting` 值以外的东西；`/api/export` 不需要登录（本机单人用），但**它会把全部学生信息吐出来**，分享文件前提醒用户一句。

## 20. 这一批新踩的坑（写页面/写接口前先看）

- **`GET /api/lessons` 只给字符串，不给数组**。列表接口是 `group_concat` 出来的 `student_names`（顿号拼接）和 `student_ids`（逗号拼接），**没有 `students: []`**；只有详情接口 `GET /api/lessons/[id]` 才有 `students` 数组。打印页当初就是按 `r.students.length` 算人次，结果整页白屏（`Cannot read properties of undefined`）。要人数就 `student_names.split("、").length`，`smoke9.mjs` 有两条断言守着这件事。
- **`attendance` 表没有 `topic` 列**。知识点只存在 `note` 表（`note.lesson_id` + `note.student_id` + `topic`）。查询要带 `left join note n on n.id = (select n2.id from note n2 where n2.lesson_id = l.id and n2.student_id = ls.student_id order by n2.id desc limit 1)`，别再写 `a.topic`——那会 500。
- **`Btn` 没有 `href`**。`ui.tsx` 的 `Btn` 是 `ButtonHTMLAttributes`，要跳页面就写 `<a className="btn btn-primary" href="…">`（配 `Icon` 一起用），别给 `Btn` 传 `href`。
- **日期参数要真校验**，光靠 `/^\d{4}-\d{2}-\d{2}$/` 会放过 `2026-13-99`。用 `new Date(y, m-1, d)` 回读年月日比对（见 `api/records/route.ts` 的 `isDate()`）。
- **`fail()` 收的是错误对象**：`return fail(new Error("起始日期不对"))`，别传字符串（`src/lib/http.ts:fail(e: unknown, status = 400)`）。
- **冒烟必须清库后按 smoke2→smoke9 顺序跑**：`smoke2` 断言的是绝对总额（本月收款 1200、充值 540 分钟），带残留数据必然假失败；`ui-check` 那步也假设库里没有课程。
- **客户端渲染的页面，接口冒烟查不到内容**。`/calendar/print`、`/records` 这类页面在静态 HTML 里只有骨架，断言只能查 200 与固定文案，真正的正确性要靠 `cdp-err.mjs` 看控制台 + 截图看版面。

## 21. 家长分享页与反馈语气

- 分享链接是 **HMAC 签名**，不是数据库里的一条记录：`shareToken(id)` = `HMAC-SHA256(share_secret, "student:"+id)` 取前 24 位十六进制。密钥第一次用到时随机生成写进 setting `share_secret`；「换个新令牌」= 重新生成密钥（所有旧链接一起失效，这正是预期行为）。
- 分享页是**只读、只给一部分**：剩余课时、下次上课、最近 3 条学情、最近 6 节课。**永远不要把电话、微信、金额放进去**——加字段前先问一句「家长该不该看到这个」。
- **`lesson_student` 没有 status 列**，出勤状态在 `attendance`。查这节课这个学生来了没有，要 `left join attendance a on a.lesson_id = l.id and a.student_id = ls.student_id` 取 `a.status`；写 `ls.status` 直接 `no such column: ls.status`（500，而且只在有学生时才暴露）。
- 分享页不要导航栏：**不要试图再套一层 route group**（根 layout 的 AppShell 会包住一切），正确做法是 `AppShell` 里对 `/share` 开头的 pathname 提前 return 一个裸容器。
- **`?new=1` 这种「页面加载时读 search」的写法，软跳转不会再触发**：`<Link href="/plans?new=1">` 在 /plans 上点只是改 query，组件不重新挂载，`useEffect` 不会重跑，看着像「点了没反应」。手机上的浮动 ➕ 因此改成 `<button>` + `window.location.href = …`（硬跳转），`useAutoNew` 不用动。
- **`.fab` 的断言看 `aria-label`，不能看 `href`**（它已经不是 `<Link>` 了）。
- `mdText()` 不是 Markdown：`src/lib/format.ts` 的 `mdText(dateStr)` 是「11月5日」这种月日格式化（名字骗人），要渲染 Markdown 用 `src/lib/markdown.ts` 的 `renderMarkdown`。分享页当初拿 `mdText(n.content)` 当渲染器，家长看到的正文变成「NaN月NaN日」。
- 分享页的徽标口径：来了 → `出勤`（ok）；请假/缺席照实说（warn）；**过去了的课还没记 → `待记一笔`**（warn）；停课 → 停课。家长不该看到「待上课」这种老师视角的词。
- 反馈语气是三条分支，不是三种模板：`buildReport/buildLessonReport` 收 `tone: "plain" | "warm" | "brief"`，只改开头那句、下一步的条数和收尾那句，**事实与数字一个字都不变**。setting 键是 `feedback_tone`。
- **`settings/page.tsx` 的 `save()` 是逐项手写提交的**：加新设置项必须同时在这份「要提交哪些键」的列表里加一行，否则输入框能改、保存没反应。

## 22. 对接接口（给别的程序用）

- `GET /api/health`、`GET /api/version` **不校验令牌**——它们是探活口（启动器、监控、`/api/v1` 的前置检查都用它）。
- `/api/v1/*` 每个 handler 第一行都是 `const denied = guard(req); if (denied) return denied;`。新加一个 v1 接口别忘了这句，否则等于把数据敞开。
- 能力边界：**只读 + 两个写**（建学生、写学情）。不提供删改——接口只做增量，不碰历史，出事时人工能兜住。
- **JSON 响应必须带 `charset=utf-8`**。只写 `application/json` 时 PowerShell 的 `Invoke-RestMethod` 会按 Latin-1 解码，中文变成「è¯¾å」；浏览器不受影响，所以这个坑只有自己写脚本对接时才会撞上（真的撞过）。
- 令牌格式 `as_` + 24 字节十六进制，存 setting `api_token`（13 项 setting 之一）。「关闭对接」= 清空这个键，所有 v1 立刻 403。
- 文档页 `/docs` 与接口实现是两份东西，**改接口必须顺手改 `/docs`**，它是给用户抄的。

## 23. 封装成桌面软件（dist\）

- **不要开 `output: "standalone"`**。本项目用 pnpm，`node_modules` 全是符号链接，Next 在 Windows 上建 symlink 会 `EPERM`，build 直接以 `Build error occurred` 失败（试过一次，报错长得像权限问题，其实是平台限制）。
- 打包走 `scripts/package.ps1`：普通 `next build` → 复制 `.next` 与 `public` 到 `dist\app` → 在 `dist\app` 里 `npm install --omit=dev --ignore-scripts --registry=npmmirror` → 把项目里**已经编好**的 `better_sqlite3.node`（ABI 137，对应 Node 24）拷进去 → 拷 `node.exe` → `csc` 编 `launcher\Launcher.cs`。
- `npm install` 必须 `--ignore-scripts`：否则它会拿当前 PATH 里的 node 去 `node-gyp rebuild`，而本机 PATH 首位是 Electron 的 node（ABI 148），必然 `NODE_MODULE_VERSION 137 vs 148` 打架。
- 启动器是 **C# 5**（`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` 只到 C# 5）：`$"..."`、`nameof`、`?.`、表达式体成员都不能用。中文源码用 `/codepage:65001` 编译。
- node 子进程挂在 **Job Object**（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）上：启动器被任务管理器强杀时，系统会把 node 一起收掉，不会留下占着端口又没有窗口的僵尸进程（`Stop-Process -Force` 实测过，端口确实释放）。
- **`.ps1` 里不要写中文注释**：文件没有 BOM 时 PS 5.1 按 GBK 解析，中文注释会把后面几行吃掉（症状是 `$root` 莫名变 null，报 `JoinPath ... 参数为 null`）。`package.ps1` 因此全 ASCII；真要写中文就用 `[System.IO.File]::WriteAllText($p,$t,[System.Text.UTF8Encoding]::new($true))` 存成带 BOM。
- 端口从 3210 往上找空的；`dist\app\data\.port` 记着这次用的端口，下次启动发现端口上已经有自己（`/api/health` 里 `app == "after-school"`）就只开浏览器，不起第二个进程。
- 打包体积约 415 MB（`node.exe` 94 MB + Next 运行期依赖）。`dist\` 是产物，随时可删了重打；**项目本体 `E:\after-school` 一个字不动**，开发照旧 `pnpm dev`，两套数据目录互不影响。


## 24. 月报（/monthly）与几个容易搞错的接口

口径（跟「上课记录」页一致，改之前先读一遍）：

- 上课节数 = 该月排给这个孩子、且 `lesson.status <> 'cancelled'` 的课（`count(distinct l.id)`）；已取消的不算。
- 出勤 = `present + makeup`；请假 / 缺勤 各自计数；出勤率只按**记过考勤的**算（`attended / (attended + leave + absent)`），没记的课不参与，否则月初全是 0%。
- 待记录 = `lesson.status = 'planned' and start_at <= now`（时间过了还没点「记一笔」），这是老师最该看的一列。
- 消耗课时取 `attendance.billed_minutes` 之和，**不要**按 `lesson.minutes × 次数` 硬算（请假不扣、补课按实际）。
- 本月收款取 `payment.amount`（`paid_at` 落在区间内）；余额取 `v_student_balance`，跟学生页一致。
- CSV 走 `?format=csv` + `fileResponse`，**必须带 BOM**，否则 Excel 打开中文乱码。

三个踩过的坑：

- **`POST /api/lessons/[id]/finish` 的请求体是 `{ items: [...] }`，不是 `{ attendance: [...] }`**。写错不会报错：`items` 为空 → 所有学生按「到课」处理，于是「缺勤」被记成出勤、课时照扣。`scripts/seed-demo.mjs` 和 `scripts/smoke12.mjs` 里的写法是准的。
- **`POST /api/lessons` 只认 `status: "makeup"`**，传 `cancelled` 会被静默改成 `planned`。要取消一节课得 `PATCH /api/lessons/{id}` + `{ status: "cancelled" }`（PATCH 会校验三值，已 done 的课不许改）。
- **没有 `POST /api/payments`**（405）。收款一律 `POST /api/hours`：`{ studentId, deltaMinutes, kind: "purchase"|"gift"|"adjust"|"refund", amount, method, remark }`，带 `amount` 才会顺带插一条 payment。
- 统计口径的数字全部**当场查库**，不落表、不缓存；页面每次换月都重新请求，所以「改完数据回来看一眼」永远是最新的。

---

## 25. 删备份 / 家长页「本月小结」（这一批的口径）

**删备份**（`src/lib/backup.ts` 的 `removeBackup(name)`）：

- 入口只有一个：`DELETE /api/backup?file=名字`（`src/app/api/backup/route.ts`）。名字先过 `backupPath()` 白名单（`^(auto|manual)-\d{4}-\d{2}-\d{2}-\d{4}(\d{2})?(-\d+)?\.db$`），`../` 之类直接 400，别自己再拼一层路径校验。
- 删的时候要连带清 `-wal` / `-shm`：留着它们，下次恢复可能捞到一个「没关干净」的文件。
- 返回 `{ removed, left, freed }`，前端拿它拼 toast（「已删掉 X，省出 Y，还剩 Z 份」），别在前端自己算剩余份数。
- 前端每行三个按钮：↻ 恢复 / ⬇ 下载 / 🗑 删除。删除按钮用 `.btn-danger-ghost`（平时灰、悬停才红），**必须配 `Confirm` + `danger`**；确认框文案要写明「只影响这份快照，现在正在用的数据一个都不动」。
- 备份列表不再 `slice(0, 6)`：整份列出来、外面套 `maxHeight: 320 + overflowY: auto`，30 份也能翻着删。

**家长页「本月小结」**（`/api/share` 的 `month` 字段）：

- 口径跟月报一致：`lessons` 去掉 `cancelled`、`attended = present + makeup`、`billedMinutes` 取 `attendance.billed_minutes` 之和、`leave` / `absent` 各自计数。
- **`next`（下次上课）必须用本地时间串比**：`start_at` 存的是 `'YYYY-MM-DD HH:mm'`，拿 `new Date().toISOString()` 去比会差 8 小时——今天下午的课会被当成「已经过去」，家长看不到「下次上课」。用 `toDateTimeStr(new Date())`（`src/lib/dates.ts`）。
- 家长页只给能看的：姓名/年级/学校、剩余课时、下次上课、最近 6 节课、最近 3 条小结、本月三个数字。**永远不给手机号、微信、金额**；smoke13 有一条断言专门盯这个（页面文本不能出现 `1\d{10}`）。
- 页面口径改了就同步改 `docs/` 里给家长的那句说明？不需要——家长页没有文档，改 `/api/share` 的字段时只要保证旧字段不漏、新字段都是加法。

---

## 26. 内置使用说明、侧边栏收/展、作者署名（1.3.0 → 1.4.0 这一批）

**顶栏那个 ☰ 原本是坏的，原因值得记住：**

- `globals.css` 第 295 行写了 `.topbar-menu { display: none }`，看起来像是「只在手机上显示」。但 `.btn`（同文件第 692 行）写着 `display: inline-flex`，**特异性相同、位置更靠后** → 后写的赢，桌面端这个按钮其实一直在显示。
- 它当时绑的是 `setNavOpen(true)`，桌面上只会让 `.scrim` 出现一层遮罩，看不见任何变化——所以「点了一点反应都没有」。**改任何 `display` 之前先确认没有更靠后的同特异性规则覆盖它**；拿不准就直接在文件末尾的新分区里写，别在原处改。

**侧边栏收/展：只剩两个入口，各管一个方向（1.4.0 定的）：**

- 展开状态 → **侧栏最下面那行 `.sidebar-fold`「收起侧边栏」**（带 `Ctrl+B` 提示）；收起状态 → **侧栏里唯一剩下的 `.brand-mark-btn`「课」方块**，或者顶栏的 `.topbar-menu`（只在 `narrow || collapsed` 时才渲染，所以展开时桌面上不会出现第二个「收起」按钮）。三个入口都调同一个 `toggleNav()`。
- 不要再往 brand 行里放假箭头（`.sidebar-collapse` 已删除）：那一行展开时已经够挤，而且会让「两个入口」变成三个。
- 状态：`navCollapsed`（桌面折叠）+ `narrow`（≤980px，走抽屉）。`const collapsed = navCollapsed && !narrow;`——手机上永远是抽屉，不折叠成图标条。
- 记忆：`localStorage["as-nav-collapsed"] === "1"`；`Ctrl/⌘ + B` 也走同一个 `toggleNav()`；`aria-expanded` 跟着变，别只改图标。
- 折叠靠一个变量：`.shell.nav-collapsed { --sidebar-w: 66px }`，`.main` 是 `margin-left: var(--sidebar-w)`，所以只改这一个值，侧栏宽度和内容偏移一起动；过渡写在 `.sidebar`/`.main` 的 `transition` 上（尊重 `prefers-reduced-motion`）。
- 折叠后必须还能认出入口：`.nav-item` 居中、`title={label}` 出悬浮名、`.nav-count` 收成 6px 圆点、`.nav-group-label` 与 `.sidebar-foot` 隐藏，但保留分组分隔线（`.sidebar-nav > div + div`）。
- `.topbar-menu.attention` 是收起后才出现的高亮版本（淡品牌色）——那时它才是唯一的「回来」的路；展开时它根本不渲染。

**作者署名（1.5.0 起写死在代码里，不再进设置）：**

- 唯一来源：`src/lib/author.ts` 的 `AUTHOR_NAME = "nekoosu"`、`AUTHOR_URL = "https://github.com/Nekoosu"`（想换人就改这两行）。setting 里**没有** `author_name/author_url` 了（1.4.0 曾放进 setting，用户明确要求写死，已删）。
- 三处读它：侧栏底部 `.sidebar-author`（文案固定「作者：nekoosu」）、`/manual` 扉页 `.manual-credit` 与尾页 `.manual-sign`、「关于」卡的作者行。都是 `target="_blank" rel="noreferrer"`。
- 手册扉页那块在 `@media print` 里是隐藏的（`.manual-top` 整块），所以**尾页的 `.manual-sign` 才是打印版唯一会出现的署名**，别删。

**发布流程（1.5.0 起固定）：**

- `scripts/package.ps1` → `Compress-Archive dist\* release\after-school-<版本>.zip`（**压缩包名 = 项目名-版本号**，用户定的规矩，以后每个版本都这么命名）→ GitHub API 建 release（tag `v<版本>`，POST `/repos/Nekoosu/after-school/releases`）→ 用 `curl.exe -x http://127.0.0.1:7899 --data-binary "@release\xxx.zip"` 传到 `uploads.github.com`。`release/` 已进 `.gitignore`。
- README「直接使用」段放 [releases/latest](https://github.com/Nekoosu/after-school/releases/latest) 链接并写明命名规则。

**内置使用说明（`/manual`）：**

- 正文只存在一处：`src/lib/manual.ts` 的 `MANUAL`（`ManualSection[]`，块类型 `p / h3 / steps / list / note / table`）。`MANUAL_TOC` 从它派生成 `{id,title}`，**加章节只改 `MANUAL`，目录和锚点自动跟上**。
- 定位是**操作说明**，不是功能介绍：每章写「点哪里 → 看到什么 → 出错怎么办」，能写成步骤就别写成段落；「逐页操作速查」那张表是给人查「这个功能在哪个页面」的，页面上的按钮改了要优先更新它。
- 页面只管渲染：`rich(text)` 只认 `` `代码` `` 和 `**加粗**` 两种记号（正则 `/(\*\*[^*]+\*\*|`[^`]+`)/g`），别指望它当 Markdown 用。
- **手册里不写版本记录**（用户明确不要这一章）：版本号只在扉页与尾页的 `MANUAL_META.version` 出现一次，跟着 `lib/version.ts` 走，别再往正文塞「本次更新了什么」。
- 目录高亮：每节 `<section id={"sec-"+id} data-sec={id}>`，滚动监听用 `window.scrollY + 140` 找当前节；`jump(id)` 用 `scrollIntoView`。`ui-check` 的 `[14]` 断言的是「目录条数 === 节数」和「点一下 `scrollY` 变大」，改结构时别把这两个属性弄丢。
- 打印：靠 `.no-print`（打印按钮、目录、返回顶部）与 `@media print` 里的隐藏规则；`.manual-sec` 有 `scroll-margin-top`，否则跳过去会被顶栏盖住。

**这一批的验证基线**：smoke2→smoke14 共 **387 项**、单元测试 **40 项**、`ui-check` **85 项**（[15] 侧边栏 13 条、[16] 作者署名 5 条、[17] 复制到下周/导出日历/AI 自动获取 5 条），打包版 `dist\AfterSchool.exe`、`APP_VERSION` **1.5.0**。

## 27. 1.5.0 新增的三个接口（课表与 AI）

**`POST /api/lessons/copy-week { from, to }`**：把区间内的 `planned/makeup` 课**整体加 7 天**复制一份（同课程、同学生、同时长、同教室），撞课的跳过不报错。返回 `{copied, skipped, skippedTitles}`。
- 日期一律先过 `isDayStr()`（`src/lib/dates.ts`）：正则 + `new Date(y,m-1,d)` 回读比对。**只写 `/^\d{4}-\d{2}-\d{2}$/` 会放过 `2026-13-01`**——smoke14 第一次就是这么挂的（`ics 日期不合法 400 → 200`）。
- 冲突判断复用 `findConflicts(ids, newStart, minutes, 0)`，别自己写时间重叠；跳过理由里要带新时间，前端 toast 直接展示。
- 事务里 `insert ... returning id` 拿新 id 再复制 `lesson_student`，别忘 `class_id`/`plan_id` 也照抄。

**`GET /api/calendar.ics?from&to`**：导出 .ics（`text/calendar; charset=utf-8`，`Content-Disposition` 用 `filename="ascii"` + `filename*=UTF-8''…`，中文名走 RFC 5987）。
- 时间用**浮动本地时间**（`DTSTART:20261105T163000`，**不带 Z**），否则手机日历会按 UTC 显示成半夜。
- 只导 `status <> 'cancelled'`；`DURATION:PT{n}M` 比 `DTEND` 省事；行必须 `\r\n` 分隔，`icsEsc()` 要转义 `\ ; , 换行`。

**`POST /api/ai/models { base, key }`**：拉 `${base}/models`（15 秒 `AbortController` 超时），返回 `{ok, models, base}`；**所有失败都回 `ok({ok:false, error})`，不抛 500**（AI 是可选功能，不能因为模型名拉不到就让设置页崩）。前端用 `<input list="ai-model-options">` + `<datalist>`，自动套第一个模型名。

## 28. macOS 版（为什么 Windows 出不了，以及 package-mac.sh 怎么打）

**Windows 上产不出能跑的 Mac 包**，三个硬限制：① `better-sqlite3` 是原生模块，要 darwin-arm64/x64 的 prebuild，Windows 装不出来；② `.app` 里可执行文件靠权限位，Windows 的任何压缩工具都存不下 Unix 的 `x` 位，解压出来双击没反应；③ 无法实测。所以流程是：**Windows 写好脚本 → 在任意一台 Mac 上跑 `bash scripts/package-mac.sh`**（几分钟，现场装依赖、现场拿 darwin 原生模块），产物 `build/mac/课后服务管理.app` 与 `release/after-school-<版本>-macos-<arm64|x64>.tar.gz`。

`scripts/package-mac.sh` 八步：环境检查（`uname -m` 定 arm64/x64，版本号从 `src/lib/version.ts` grep）→ `npm install` → `npx next build` → 组装 `.app`（复制 `.next` 去 cache/trace、`public` 去 README.md，写运行期 `package.json` 与 `next.config.js`）→ `npm install --omit=dev`（**不要 `--ignore-scripts`**，better-sqlite3 靠 prebuild-install 下载 darwin 版；没有 prebuild 就 `npm rebuild --build-from-source`，需要 `xcode-select --install`）→ node 可执行文件（本机 `file $(command -v node)` 是 Mach-O 就直接拷，否则从 nodejs.org 下载 darwin tar 解出 `bin/node`）→ 拷 `launcher/mac/start.sh`/`stop.sh`、写 `Info.plist`（`LSUIElement true` 不占 Dock、`CFBundleExecutable start`）、`sips`+`iconutil` 从 `public/app-icon.png` 生成 `app-icon.icns` → `tar -czf`（**必须 tar 不能 zip**，只有 tar 保权限位）。

- `launcher/mac/start.sh` 与 Windows 的 `Launcher.cs` 职责一致：读 `data/.port` 已在跑就 `open` 浏览器；`lsof -nP -iTCP:$p -sTCP:LISTEN` 从 3210 起挑端口；`NODE_ENV=production nohup "$NODE" .../next start -H 127.0.0.1 -p $PORT >> data/server.log 2>&1 &` + `disown`；pid/port 写 `data/.pid`/`.port`；`curl` 轮询 `/api/health` 90 秒；成功 `open` + `osascript display notification`，失败 `display alert` 指向日志。
- 退出不走 Dock（`LSUIElement` 隐藏了），靠包外的 `停止课后服务.command`（读 `.pid` kill，兜底 `pkill -f` 只匹配本 .app 的 next 路径）。
- 用户侧第一次会被 Gatekeeper 拦（无签名）：右键 → 打开，或 `xattr -dr com.apple.quarantine`。
- 语法检查可用本机 cygwin bash：`E:\tools\PortableGit\bin\bash.exe -n <脚本>`；**脚本必须 LF 行尾**（cygwin bash 对 CRLF 报 `$'\r'`）。
- **`.dmg` 只能在 Mac 上生成**（`hdiutil` 是系统自带、无 Windows 替代）：`package-mac.sh` 第 8 步会顺手打一个 `release/after-school-<版本>-macos-<arch>.dmg`，给用户的正式包是这个 dmg，tar.gz 只是备胎。

**没有 Mac 时的「盲拼」路径（做过了，结构可验证、运行不可验证）**：① `curl -L -o node-darwin-arm64.tar.gz https://nodejs.org/dist/v24.22.0/node-v24.22.0-darwin-arm64.tar.gz`（注意 Windows `tar --strip-components` 与成员选择不能同时用，整包解开再拷 `bin/node`；里面的 `npm`/`npx`/`corepack` 是符号链接，Windows 解不出来，会报 `Invalid argument`，不影响）；② better-sqlite3 用 `https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/better-sqlite3-v12.11.1-node-v137-darwin-arm64.tar.gz`（`node-v137` 就是 Node 24 的 ABI），解出的 `build/Release/better_sqlite3.node` 放进运行期 `node_modules`；③ 运行期依赖用 `npm install --omit=dev --os=darwin --cpu=arm64 --ignore-scripts` 装（npm 11 认 `--os`/`--cpu`，能拿到 `@next/swc-darwin-arm64`、不会拉 win32 的）；④ 压缩方式**决定能不能用**：Windows 的 `Compress-Archive` 不写 Unix 权限位，解压后双击没反应——要用 Python `zipfile` 自己写 `external_attr = ((mode|S_IFREG) << 16)`、`create_system = 3`，给 `Contents/MacOS/{start,stop}`、`node`、`停止课后服务.command` 记 `0o755`（脚本在 `.macbuild/pack-zip.py`）；⑤ 结构验证：两个二进制魔数必须是 `CF FA ED FE`（arm64 Mach-O），zip 里再抽查权限位。