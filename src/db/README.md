# src/db —— 表结构与连接

```
ddl.ts   建表语句 + 视图 + 幂等索引 + setting 种子（13 张表、2 个视图、13 项设置）
index.ts 单例连接（WAL、foreign_keys=ON）、sqlite/all/get/run/tx、setting()、ensureColumn()、reopenDb()
types.ts 行类型（与 DDL 一一对应，改表要同步改这里）
```

## 数据模型的三条主线

1. **学生 → 排课 → 出勤**：`student` ← `lesson_student` → `lesson`，出勤在 `attendance`（一人一行，`UNIQUE(lesson_id, student_id)`）
2. **课时是流水账**：`hours_ledger` 只追加（`purchase / gift / adjust / refund / consume`），**余额永远是 `SUM(delta_minutes)`**，没有「余额字段」这种东西——这是这个项目最重要的一个决定，别改
3. **学情只追加**：`note` 一张表，`kind` 区分 progress / behavior / plan，知识点存 `topic` + `level(1-5)`

两个视图：`v_student_balance`（剩余课时）、`v_makeup_pending`（待补的课）。

## 改表的时候

- **老库也要能开**：新增列写在 `ddl.ts` 里，同时确认 `ensureColumn("表","列","定义")` 有覆盖（`reopenDb()` 会重跑 DDL + 补列，所以恢复旧备份也能升上来）
- 加索引要幂等：`create index if not exists`
- 新 setting 键加在种子 `INSERT OR IGNORE INTO setting ...` 里，空库才有默认值；已有库靠用户在设置页填
- 类型改完跑 `tsc --noEmit`，`types.ts` 漏改会立刻报出来

## 别做的事

不要引入 ORM、不要加「软删除」字段、不要给课时表加余额列、不要为了一个统计需求新建表——先看能不能用现有表 join 出来。这个库的目标是「一个人能一眼看懂全部表结构」。
