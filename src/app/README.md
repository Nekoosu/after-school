# src/app —— 页面与接口

一页一个目录，一个接口一个文件。**页面是客户端组件（`"use client"` + `useEffect` 取数），接口是动态的（`export const dynamic = "force-dynamic"`）**——这套单机应用不需要 SSR，也不需要缓存。

```
page.tsx                 今日看板：今天几节课、谁余额不够、谁两周没聊了
calendar/                课表（周/月视图、拖拽换天、复制到下周、导出 .ics）
calendar/print/          一页一周，打印用
students/                学生列表、学生详情（六个 Tab）、月度对账单
lessons/[id]/            记一笔（出勤 + 课时 + 学情一次填完）
lessons/[id]/wrap/       跟家长说一句（下课反馈向导）
feedback/                家长反馈（按周期批量出草稿）
plans/                   备课与教案
records/                 上课记录（一节课一个学生一行，可筛可导）
monthly/                 月报（按月聚合，可导 CSV）
finance/                 收支（收款 + 课时流水）
stats/                   统计（热力图、趋势）
classes/                 班级
settings/                设置（机构、上课默认值、AI、备份、对接、关于）
manual/                  内置使用说明（20 章操作手册）
docs/                    接口文档（给接别的程序的人看）
share/[id]/              家长只读页（无侧栏无顶栏，靠签名链接访问）
api/…                    47 个接口，见下
```

## api/ 的分区

| 目录 | 管什么 | 例子 |
| --- | --- | --- |
| `api/students`、`api/lessons`、`api/courses`、`api/classes` | 主体业务 | 排课、记出勤、课时充值 |
| `api/notes`、`api/feedback`、`api/plans` | 学情与教学内容 | 写学情、出反馈草稿、存教案 |
| `api/reports`、`api/stats`、`api/records`、`api/export` | 只读的统计与导出 | 月报、热力图、CSV |
| `api/backup`、`api/restore`、`api/import` | 数据进出 | 备份列表、恢复、导入 JSON |
| `api/v1/*`、`api/health`、`api/version`、`api/token` | 给外部程序用 | 带令牌的只读接口 |
| `api/ai`、`api/share` | 可选能力 | AI 润色与模型名、家长分享链接 |

## 写新页面的步骤

1. 建 `app/xxx/page.tsx`，第一行 `"use client"`
2. 取数用 `@/lib/client` 的 `api<T>()`/`post()`，别手写 fetch
3. 骨架用 `components/ui.tsx` 的 `Card`/`CardHead`/`Section`/`Btn`/`Stat`
4. 在 `components/AppShell.tsx` 的 `GROUPS` 里加入口、`TITLES` 里加标题
5. 空态一定给（`Empty`），否则第一次用的人看到一片白
6. 跑 `node scripts/ui-check.mjs`，它会真的点一遍

## 写新接口的步骤

1. 建 `app/api/xxx/route.ts`，文件头写 `export const dynamic = "force-dynamic"`
2. 返回统一用 `@/lib/http` 的 `ok()` / `fail()`（**不要直接 `new Response(JSON.stringify(...))`，字符集容易漏**）
3. 参数校验用 `need()`，日期用 `isDayStr()` 回读校验，不要只靠正则
4. 要令牌的接口第一行 `const denied = guard(req); if (denied) return denied;`
5. 在 `scripts/smoke*.mjs` 里加断言——**接口没被断言过就等于没有**
