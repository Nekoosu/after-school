# scripts —— 冒烟、点击检查、截图、打包

这些脚本是「改完之后怎么证明没坏」的全部答案。**接口没被断言过就等于没有**。

## 冒烟（按顺序跑，前面的会在库里留数据给后面用）

```powershell
# 先清空 data 与 backups，再起服务，然后从 2 跑到 14
foreach ($n in 2..14) { node scripts\smoke$n.mjs http://127.0.0.1:3319 }
```

| 脚本 | 项数 | 管什么 |
| --- | --- | --- |
| `smoke2.mjs` | 33 | 全部页面能打开、核心增删改查（**断言绝对总额，必须清库后第一个跑**） |
| `smoke3.mjs` | 7 | 一键补课、搜索、热力图、Service Worker |
| `smoke4.mjs` | 9 | 批量反馈、拖拽改期（PATCH `startAt`）、「该跟家长说句话了」 |
| `smoke5.mjs` | 34 | 自动备份、知识点、冲突预检、AI 失败回退 |
| `smoke6.mjs` | 30 | 重复排课、月度对账单、全量 JSON 导出、首页收款趋势 |
| `smoke7.mjs` | 30 | 下课反馈向导（取教案要点、单节课版文案） |
| `smoke8.mjs` | 46 | 导入导出：CSV/JSON、dryRun 试算、重名跳过、BOM |
| `smoke9.mjs` | 33 | 上课记录筛选、记录导出、课表打印页 |
| `smoke10.mjs` | 43 | 对接接口（health/version/token/v1）、从备份恢复 |
| `smoke11.mjs` | 24 | 家长分享链接（签名、只读字段、错误 403）、反馈语气 |
| `smoke12.mjs` | 34 | 月报聚合、CSV、月份参数校验 |
| `smoke13.mjs` | 36 | 删备份、家长页「本月小结」与「下次上课」的时区 |
| `smoke14.mjs` | 28 | 课表「复制到下周」（撞车跳过）、导出 `.ics` |

合计 **387 项**。

## 真实浏览器点击

```powershell
powershell -ExecutionPolicy Bypass -File scripts\ui-check.ps1
```

它自己清库、起 3318 端口、用无头 Edge 点 85 项、收尾停服务。**HTTP 200 不代表页面正常**——客户端渲染的页面白屏只有这里能发现。

`ui-check.mjs` 也可以单独对着已跑的服务用：`node scripts\ui-check.mjs http://127.0.0.1:3319`。

## 工具

| 脚本 | 用途 |
| --- | --- |
| `shot.mjs` | 无头浏览器截图（支持 `collapse`、`scroll`、`SHOT_SHARE`），产物到 `.shots\pack\` |
| `evaljs.mjs` | 在页面里跑一段 JS 并打印结果（量高度、看 computed style）；表达式含引号就写文件用 `@路径` 传 |
| `cdp-err.mjs` | 抓控制台异常与 `body.innerText`，专门用来查白屏 |
| `seed-demo.mjs` | 灌一套演示数据（三个学生、两门课、六节课、四条学情） |
| `package.ps1` | 打包成 `dist\`（8 步：build → 复制 → 装运行期依赖 → 塞原生模块 → 内置 node → 编启动器 → 拷说明） |
| `package-mac.sh` | **在 Mac 上跑**：`bash scripts/package-mac.sh` → 组装 `课后服务管理.app` 并压成 `release/after-school-<版本>-macos-<arm64\|x64>.tar.gz`（8 步；better-sqlite3 必须现场拿 darwin 版，权限位靠 mac 的 tar） |

## 两个坑

- **`ui-check.ps1` 会清 `data`/`backups`**。如果别的服务还开着并持有 `app.db` 句柄，`Remove-Item` 会静默失败，库里残留旧数据，`[2]` 场景就会挂。跑之前先 `Get-Process node | Stop-Process -Force`。
- **Windows 上 Chrome/Edge 最小窗口宽约 500px**，截图传 `--window-size=430` 会被裁切，看着像溢出。
