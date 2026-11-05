"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, Badge, Btn, Card, CardHead, Empty, PageLoading, Section, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { api } from "@/lib/client";
import { money } from "@/lib/format";

interface Row {
  studentId: number;
  name: string;
  grade: string | null;
  lessons: number;
  attended: number;
  leave: number;
  absent: number;
  unrecorded: number;
  cancelled: number;
  billedMinutes: number;
  billedHours: number;
  paid: number;
  balanceMinutes: number;
  balanceHours: number;
  rate: number | null;
}

interface Summary {
  students: number;
  lessons: number;
  attended: number;
  leave: number;
  absent: number;
  unrecorded: number;
  billedMinutes: number;
  billedHours: number;
  paid: number;
  rate: number | null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function monthOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  return monthOf(new Date(y, m - 1 + delta, 1));
}

/** 「2026-11」→「2026 年 11 月」 */
function monthCn(month: string): string {
  const [y, m] = month.split("-");
  return `${y} 年 ${Number(m)} 月`;
}

export default function MonthlyPage() {
  const [month, setMonth] = useState(() => monthOf(new Date()));
  const [rows, setRows] = useState<Row[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ rows: Row[]; summary: Summary }>(`/api/reports/monthly?month=${month}`);
      setRows(data.rows);
      setSummary(data.summary);
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(() => {
    const list = (rows ?? []).filter((r) => r.lessons > 0 || r.paid > 0 || r.billedMinutes > 0);
    return list.sort((a, b) => b.lessons - a.lessons || a.name.localeCompare(b.name, "zh"));
  }, [rows]);

  const isThisMonth = month === monthOf(new Date());

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">月报</h1>
          <p className="page-sub">
            {monthCn(month)}：谁上了几节、缺了几次、扣了多少课时、交了多少、还剩多少。
            {isThisMonth ? "（这个月还没过完，数字每天都在变）" : ""}
          </p>
        </div>
        <div className="page-head-actions no-print">
          <div className="row" style={{ gap: 6 }}>
            <Btn icon="left" title="上个月" onClick={() => setMonth(shiftMonth(month, -1))}>
              上月
            </Btn>
            <input
              type="month"
              className="input"
              value={month}
              aria-label="选择月份"
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
              }}
              style={{ width: 150 }}
            />
            <Btn icon="right" title="下个月" onClick={() => setMonth(shiftMonth(month, 1))}>
              下月
            </Btn>
          </div>
          <a className="btn" href={`/api/reports/monthly?month=${month}&format=csv`}>
            <Icon name="download" size={16} />
            导出 CSV
          </a>
          <Btn icon="printer" onClick={() => window.print()}>
            打印
          </Btn>
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      {summary ? (
        <div className="stat-grid">
          <Stat
            label="上课节数"
            value={summary.lessons}
            unit="节"
            icon="calendar"
            foot={summary.students > 0 ? `${summary.students} 个孩子有课` : "这个月还没排课"}
          />
          <Stat
            label="出勤率"
            value={summary.rate ?? "—"}
            unit={summary.rate === null ? "" : "%"}
            icon="check"
            tone={summary.rate === null ? undefined : summary.rate >= 90 ? "ok" : summary.rate >= 70 ? "warn" : "bad"}
            foot={`出勤 ${summary.attended} · 请假 ${summary.leave} · 缺勤 ${summary.absent}`}
          />
          <Stat
            label="消耗课时"
            value={summary.billedHours}
            unit="小时"
            icon="clock"
            tone="violet"
            foot={summary.unrecorded > 0 ? `还有 ${summary.unrecorded} 节没记` : "都记完了"}
          />
          <Stat
            label="本月收款"
            value={money(summary.paid)}
            icon="wallet"
            tone="ok"
            foot={`${summary.students} 个孩子里有 ${sorted.filter((r) => r.paid > 0).length} 个交过`}
          />
        </div>
      ) : null}

      <Section title={`${monthCn(month)}明细`} count={sorted.length}>
        {loading && !rows ? (
          <PageLoading />
        ) : sorted.length === 0 ? (
          <Card>
            <Empty
              icon="chart"
              title="这个月还没有数据"
              text="换个月看看，或者先去课表排几节课"
              action={
                <a className="btn" href="/calendar">
                  <Icon name="plus" size={16} />
                  去排课
                </a>
              }
            />
          </Card>
        ) : (
          <Card>
            <CardHead
              title="按孩子看"
              sub="出勤率只算记过考勤的课；「待记录」是时间到了但还没记的"
            />
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>学生</th>
                    <th className="nowrap">上课</th>
                    <th className="nowrap">出勤</th>
                    <th className="nowrap">请假</th>
                    <th className="nowrap">缺勤</th>
                    <th className="nowrap">待记录</th>
                    <th className="nowrap">消耗课时</th>
                    <th className="nowrap">本月收款</th>
                    <th className="nowrap">剩余课时</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => (
                    <tr key={r.studentId} onClick={() => (window.location.href = `/students/${r.studentId}`)}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <Avatar name={r.name} size="sm" />
                          <div>
                            <div className="cell-main">{r.name}</div>
                            <div className="cell-sub">{r.grade ?? "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td className="nowrap strong">{r.lessons}</td>
                      <td className="nowrap">
                        <span className="strong">{r.attended}</span>
                        {r.rate !== null ? <span className="muted fs-sm"> · {r.rate}%</span> : null}
                      </td>
                      <td className="nowrap">{r.leave || <span className="dim">—</span>}</td>
                      <td className="nowrap">
                        {r.absent ? (
                          <Badge tone="bad">{r.absent}</Badge>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td className="nowrap">
                        {r.unrecorded ? (
                          <Badge tone="warn">{r.unrecorded}</Badge>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td className="nowrap">{r.billedHours ? `${r.billedHours} 小时` : <span className="dim">—</span>}</td>
                      <td className="nowrap">{r.paid ? money(r.paid) : <span className="dim">—</span>}</td>
                      <td className="nowrap">
                        {r.balanceHours > 0 ? (
                          `${r.balanceHours} 小时`
                        ) : (
                          <Badge tone="bad">用完</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-foot row between">
              <span className="muted fs-sm">
                共 {sorted.length} 个孩子 · 上课 {summary?.lessons ?? 0} 节 · 扣课时 {summary?.billedHours ?? 0} 小时 · 收款{" "}
                {money(summary?.paid ?? 0)}
              </span>
              <span className="muted fs-sm">点一行看这个孩子的档案</span>
            </div>
          </Card>
        )}
      </Section>
    </>
  );
}
