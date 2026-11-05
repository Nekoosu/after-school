# tests —— 单元测试

只测**纯函数**，不碰数据库、不启服务、不发请求。所以跑起来是秒级，改一行逻辑就能立刻验证。

```powershell
node --test tests\hours.test.ts tests\scheduling.test.ts tests\report.test.ts tests\token.test.ts
```

## 四个文件

| 文件 | 测什么 | 为什么值得测 |
| --- | --- | --- |
| `hours.test.ts` | 课时账：该不该扣、扣多少、余额够不够、补课还没上、文案怎么写 | 这是钱。算错了家长会来找你，所以要有一堆边界用例（请假不扣、补课不重复扣、余额不足仍可上课但提示续费） |
| `scheduling.test.ts` | 周/月视图的时间轴、跨周跨月、分列 | 日期边界最容易出错，`addDays` 收的是 `Date` 不是字符串（踩过） |
| `report.test.ts` | 家长反馈文案：三种语气、两种版本（按周期/单节课）、教案要点提取 | 文案是给家长看的，改了措辞要知道哪些用例会变 |
| `token.test.ts` | 接口令牌解析（Bearer / `?token=` / 大小写 / 空串）与定长比较 | 安全相关的解析逻辑，不该靠肉眼 |

合计 **40 个用例**。

## 写用例时注意

- **import 要带 `.ts` 后缀**：`import { x } from "../src/lib/hours.ts"`（不带会 `ERR_MODULE_NOT_FOUND`）
- 用 `node:test` 的 `test()` + `node:assert/strict`，不引第三方断言库
- `package.json` 的 `test` 脚本**必须点名文件**——`node --test tests/` 会报 `MODULE_NOT_FOUND`
- 新增一个纯逻辑文件，优先想「它有没有一个不需要数据库就能验证的核心判断」

## 不在这里测的东西

接口行为在 `scripts/smoke*.mjs` 里测，界面行为在 `scripts/ui-check.mjs` 里测。三层分工：单元测算术，冒烟测接口，点击检查测人能不能用。
