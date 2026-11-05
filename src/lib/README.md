# src/lib —— 纯逻辑

**不 import React，不写 JSX，不直接开数据库连接**（要数据就读 `@/db`，或者干脆由调用方把数据传进来）。所以这里的文件都能被 `node --test` 直接测。

## 分组

**课时与课表**
```
hours.ts       课时计算：能不能扣、扣多少、够不够、还差多少（余额/缺课/补课）
scheduling.ts  周/月视图的时间轴与分列
conflicts.ts   排课撞车检测（同一学生同一时间）
dates.ts       日期格式化与 isDayStr() 回读校验、addDays
```

**文字与内容**
```
report.ts        家长反馈文案：按周期汇总 / 单节课版，三种语气（plain / warm / brief）
lessonFeedback.ts 单节课的反馈草稿（取教案要点，不重复问「今天讲了什么」）
feedbackGen.ts   批量生成反馈草稿（同周期去重）
markdown.ts      极简 Markdown → HTML（先整体转义，再放行少数标记）
manual.ts        内置使用说明的正文（20 章，唯一来源）
```

**数据进出**
```
backup.ts    备份：makeBackup / listBackups / backupPath / removeBackup / ensureDailyBackup
restore.ts   恢复：校验备份 → 存快照 → reopenDb → 覆盖 app.db → 重跑 DDL
export.ts    导出 JSON / CSV（CSV 带 BOM，中文 Excel 直接开）
import.ts    导入（dryRun 试算 → 确认 → 事务写入，重名跳过不覆盖）
csv.ts       toCsv / fileResponse / stamp（Content-Disposition 中文走 RFC 5987）
```

**对接与安全**
```
token.ts    从请求里取令牌（Bearer 或 ?token=）+ 定长比较
apikeys.ts  令牌的存取与 guard()
share.ts    家长分享链接的 HMAC 签名（只暴露姓名、课时、课次，永不给联系方式）
version.ts  APP_NAME / APP_VERSION / API_VERSION —— 发版只改这里
author.ts   作者署名（写死，侧栏与说明书都读它）
```

**界面辅助**
```
client.ts   api<T>() / post / patch / del / copyText（前端取数唯一入口）
autoNew.ts  ?new=1 自动打开新建弹窗
tone.ts     读设置里的反馈语气
format.ts   时间、金额、课时的显示格式
speech.ts   浏览器语音识别的封装
html.ts     极少数需要 dangerouslySetInnerHTML 的地方的统一出口
```

## 加文件的判断

- 有副作用（读文件、开库、发请求）→ 放这里也行，但要在同一个文件里把副作用收干净，导出纯函数做真正的计算
- 只有一种用法、且只在一个页面里 → 别放这里，留在页面里
- 能被测试的越多越好：`tests/` 现在只测 `hours / scheduling / report / token` 四块，都是纯函数
