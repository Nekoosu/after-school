"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, Btn, Card, CardHead, Empty, PageLoading, Section, Segmented, Stat, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import { ATT_CN, money, moneyShort, toHours } from "@/lib/format";

interface Stats {
  months: number;
  from: string;
  revenue: number;
  revenueCount: number;
  soldMinutes: number;
  usedMinutes: number;
  remainMinutes: number;
  studentCount: number;
  pendingMakeup: number;
  lowBalanceThreshold: number;
  revenueByMonth: { month: string; amount: number; n: number }[];
  revenueByMethod: { method: string; amount: number; n: number }[];
  lessonStat: { status: string; n: number }[];
  attStat: { status: string; n: number }[];
  monthly: { month: string; lessons: number; used: number }[];
  topStudents: { id: number; name: string; used: number; amount: number; lessons: number }[];
  lowBalance: { id: number; name: string; balance: number }[];
  courseShare: { name: string; minutes: number; n: number }[];
  heatFrom?: string;
  heatmap?: { d: string; n: number; done: number }[];
}

export default function StatsPage() {
  const toast = useToast();
  const [range, setRange] = useState<"6" | "12">("6");
  const [s, setS] = useState<Stats | null>(null);

  const load = useCallback(() => {
    api<Stats>(`/api/stats?months=${range}`)
      .then(setS)
      .catch((e: Error) => toast.bad(e.message));
  }, [range, toast]);

  useEffect(load, [load]);

  const attRate = useMemo(() => {
    if (!s) return null;
    const n = (k: string) => s.attStat.find((a) => a.status === k)?.n ?? 0;
    const went = n("present") + n("makeup");
    const total = went + n("leave") + n("absent");
    return total > 0 ? Math.round((went / total) * 100) : null;
  }, [s]);

  const maxRevenue = useMemo(() => Math.max(1, ...(s?.revenueByMonth ?? []).map((m) => m.amount)), [s]);
  const maxMonthly = useMemo(() => Math.max(1, ...(s?.monthly ?? []).map((m) => m.lessons)), [s]);
  const courseMax = useMemo(() => Math.max(1, ...(s?.courseShare ?? []).map((c) => c.minutes)), [s]);

  // 热力图：26 周 × 7 天，从 181 天前那周的周一开始排
  const heatCells = useMemo(() => {
    if (!s?.heatmap) return null;
    const byDay = new Map(s.heatmap.map((h) => [h.d, h]));
    const today = new Date();
    const cells: { d: string; n: number; done: number; week: number }[] = [];
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 181);
    const dow = (start.getDay() + 6) % 7; // 0=周一
    start.setDate(start.getDate() - dow);
    const fmt = (x: Date) =>
      `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    for (let i = 0; i < 182; i++) {
      const cur = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = fmt(cur);
      const h = byDay.get(key);
      cells.push({ d: key, n: h?.n ?? 0, done: h?.done ?? 0, week: Math.floor(i / 7) });
    }
    return cells;
  }, [s]);

  if (!s) return <PageLoading />;

  const hasData = s.revenueCount > 0 || s.lessonStat.length > 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">统计</h1>
          <p className="page-sub">
            从 {s.from.slice(0, 7)} 起的整体情况，数字当场算，不存表。
          </p>
        </div>
        <div className="page-head-actions">
          <Segmented
            items={[
              { key: "6", label: "近 6 个月" },
              { key: "12", label: "近 12 个月" },
            ]}
            value={range}
            onChange={(k) => setRange(k as "6" | "12")}
          />
        </div>
      </div>

      {!hasData && (
        <Card>
          <Empty icon="chart" title="还没有数据" text="上几节课、收几笔钱之后，这里就有图看了" />
        </Card>
      )}

      <div className="stat-grid">
        <Stat label="收款合计" value={money(s.revenue)} foot={`${s.revenueCount} 笔`} icon="wallet" tone="ok" />
        <Stat
          label="已上完的课"
          value={s.lessonStat.find((l) => l.status === "done")?.n ?? 0}
          unit="节"
          foot={`待上 ${s.lessonStat.find((l) => l.status === "planned")?.n ?? 0} · 取消 ${s.lessonStat.find((l) => l.status === "cancelled")?.n ?? 0}`}
          icon="calendar"
          tone="violet"
        />
        <Stat label="消课时长" value={toHours(s.usedMinutes)} unit="小时" foot={`卖出 ${toHours(s.soldMinutes)} 小时`} icon="clock" tone="violet" />
        <Stat
          label="出勤率"
          value={attRate === null ? "—" : `${attRate}%`}
          foot={s.pendingMakeup > 0 ? `${s.pendingMakeup} 人待补课` : "没有待补课"}
          icon="check"
          tone={attRate !== null && attRate < 80 ? "warn" : "cyan"}
        />
      </div>

      <div className="grid g2 mt-3">
        <Section title="每月收款" mt>
          <Card>
            <div className="card-body">
              {s.revenueByMonth.length === 0 ? (
                <Empty
                  icon="wallet"
                  title="没有收款记录"
                  text="家长交钱后点「记一笔收款」，这里按月汇总"
                />
              ) : (
                <div className="bars">
                  {s.revenueByMonth.map((m) => (
                    <div key={m.month} className="bar-col">
                      <div className="bar-value">{m.amount > 0 ? moneyShort(m.amount) : ""}</div>
                      <div className="bar-track">
                        <div className="bar-fill ok" style={{ height: `${Math.max(3, (m.amount / maxRevenue) * 100)}%` }} title={`${m.month}：${money(m.amount)}`} />
                      </div>
                      <div className="bar-label">{Number(m.month.slice(5))} 月</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </Section>

        <Section title="每月上课 / 消课" mt>
          <Card>
            <div className="card-body">
              {s.monthly.length === 0 ? (
                <Empty
                  icon="calendar"
                  title="还没有上完的课"
                  text="下课点「记完了」，这里按月长柱子"
                />
              ) : (
                <div className="bars">
                  {s.monthly.map((m) => (
                    <div key={m.month} className="bar-col">
                      <div className="bar-value">{m.lessons}</div>
                      <div className="bar-track">
                        <div className="bar-fill violet" style={{ height: `${Math.max(3, (m.lessons / maxMonthly) * 100)}%` }} title={`${m.month}：${m.lessons} 节 / ${toHours(m.used)} 小时`} />
                      </div>
                      <div className="bar-label">{Number(m.month.slice(5))} 月</div>
                    </div>
                  ))}
                </div>
              )}
              {s.monthly.length > 0 && (
                <div className="muted fs-xs mt-2">柱子是每月课次，悬停看消课小时数。</div>
              )}
            </div>
          </Card>
        </Section>
      </div>

      <Section title="上课热力图" count={undefined} mt>
        <Card>
          <div className="card-body">
            {!heatCells ? (
              <Empty
                icon="calendar"
                title="没有数据"
                text="上过课之后，这里会亮成一片格子"
              />
            ) : (
              <>
                <div className="heat">
                  {Array.from({ length: 26 }).map((_, w) => (
                    <div className="heat-col" key={w}>
                      {heatCells
                        .filter((c) => c.week === w)
                        .map((c) => {
                          const lv = c.n === 0 ? 0 : c.n === 1 ? 1 : c.n === 2 ? 2 : c.n <= 4 ? 3 : 4;
                          return (
                            <div
                              key={c.d}
                              className={`heat-cell l${lv}`}
                              title={`${c.d}：${c.n} 节${c.done ? `（已上完 ${c.done}）` : ""}`}
                            />
                          );
                        })}
                    </div>
                  ))}
                </div>
                <div className="row between mt-2">
                  <span className="muted fs-xs">最近半年，每天上了几节课；越深越多。</span>
                  <span className="row" style={{ gap: 4, alignItems: "center" }}>
                    <span className="fs-xs muted">少</span>
                    {[0, 1, 2, 3, 4].map((lv) => (
                      <i
                        key={lv}
                        className={`heat-cell l${lv}`}
                        style={{ width: 12, height: 12, flex: "none", display: "inline-block" }}
                      />
                    ))}
                    <span className="fs-xs muted">多</span>
                  </span>
                </div>
              </>
            )}
          </div>
        </Card>
      </Section>

      <div className="grid g2 mt-3">
        <Section title="课程时间占比" mt>
          <Card>
            <div className="card-body">
              {s.courseShare.length === 0 ? (
                <Empty
                  icon="book"
                  title="还没有上完的课"
                  text="上完一节，这里就看得出哪门课占的时间多"
                />
              ) : (
                <div className="col" style={{ gap: 12 }}>
                  {s.courseShare.map((c) => (
                    <div key={c.name}>
                      <div className="row between mb-2">
                        <span>{c.name}</span>
                        <span className="muted">
                          {toHours(c.minutes)} 小时 · {c.n} 节
                        </span>
                      </div>
                      <div className="progress">
                        <i style={{ width: `${Math.round((c.minutes / courseMax) * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </Section>

        <Section title="出勤构成" mt>
          <Card>
            <div className="card-body">
              {s.attStat.length === 0 ? (
                <Empty icon="users" title="还没有出勤记录" text="下课后点「记完了」才有数据" />
              ) : (
                <div className="col" style={{ gap: 10 }}>
                  {s.attStat.map((a) => {
                    const tone = a.status === "present" ? "ok" : a.status === "makeup" ? "violet" : a.status === "leave" ? "warn" : "bad";
                    return (
                      <div key={a.status} className="row between">
                        <Badge tone={tone}>{ATT_CN[a.status] ?? a.status}</Badge>
                        <span className="strong">{a.n} 人次</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>
        </Section>
      </div>

      <Section title="上课最多的学生" count={s.topStudents.length} mt>
        <Card>
          {s.topStudents.length === 0 ? (
            <Empty
              icon="users"
              title="还没有数据"
              text="记完一节课，这里就按上课次数排出来"
            />
          ) : (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>学生</th>
                    <th style={{ textAlign: "right" }}>上课</th>
                    <th style={{ textAlign: "right" }}>消课</th>
                    <th style={{ textAlign: "right" }}>交费</th>
                  </tr>
                </thead>
                <tbody>
                  {s.topStudents.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td style={{ textAlign: "right" }}>{t.lessons} 节</td>
                      <td style={{ textAlign: "right" }}>{toHours(t.used)} 小时</td>
                      <td style={{ textAlign: "right" }} className="muted">
                        {t.amount > 0 ? money(t.amount) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      {s.lowBalance.length > 0 && (
        <Section title="课时不足" count={s.lowBalance.length} mt>
          <Card>
            <div className="card-body">
              <div className="warn-box">
                <Icon name="alert" size={15} />
                低于 {toHours(s.lowBalanceThreshold)} 小时（{s.lowBalanceThreshold} 分钟）的学生，该提醒续费了。
              </div>
              <div className="chip-list mt-2">
                {s.lowBalance.map((l) => (
                  <a key={l.id} className="chip" href={`/students/${l.id}`}>
                    {l.name}
                    <span className="danger" style={{ marginLeft: 4 }}>
                      {toHours(l.balance)} 小时
                    </span>
                  </a>
                ))}
              </div>
            </div>
          </Card>
        </Section>
      )}

      <div className="muted fs-xs mt-3" style={{ textAlign: "center" }}>
        统计范围 {s.from} 起 · 数据截止现在
      </div>
    </>
  );
}
