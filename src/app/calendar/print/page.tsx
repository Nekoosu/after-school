"use client";

import { useEffect, useMemo, useState } from "react";
import { PageLoading } from "@/components/ui";
import { Icon } from "@/components/icons";
import { api } from "@/lib/client";
import { WEEKDAYS, durationText, mdText, timeOf } from "@/lib/format";

interface Row {
  id: number;
  course_name: string;
  title: string | null;
  start_at: string;
  minutes: number;
  room: string | null;
  status: string;
  /** /api/lessons 给的是顿号拼好的名字，不是学生数组 */
  student_names: string | null;
  student_ids: string | null;
}

const STATUS_CN: Record<string, string> = {
  planned: "待上",
  done: "已上",
  cancelled: "停课",
  makeup: "补课",
};

function dstr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 这一周的周一（跟设置里的 week_start 无关，打印按周一到周日最符合直觉） */
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - wd);
  return x;
}

function shiftDays(base: string, days: number): string {
  const [y, m, d] = base.split("-").map(Number);
  return dstr(new Date(y, m - 1, d + days));
}

export default function PrintCalendarPage() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [org, setOrg] = useState("课后服务中心");
  const [error, setError] = useState("");

  // 起止日期从地址栏来；没带就取本周一到周日
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const f = q.get("from") ?? "";
    const t = q.get("to") ?? "";
    const okF = /^\d{4}-\d{2}-\d{2}$/.test(f);
    const okT = /^\d{4}-\d{2}-\d{2}$/.test(t);
    if (okF && okT) {
      setFrom(f);
      setTo(t);
    } else {
      const mon = mondayOf(new Date());
      setFrom(dstr(mon));
      setTo(dstr(new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6)));
    }
  }, []);

  useEffect(() => {
    if (!from || !to) return;
    void (async () => {
      try {
        const [ls, st] = await Promise.all([
          api<Row[]>(`/api/lessons?from=${from}&to=${to}`),
          api<Record<string, string>>("/api/settings").catch(() => ({}) as Record<string, string>),
        ]);
        setRows(ls);
        if (st.org_name) setOrg(st.org_name);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [from, to]);

  const days = useMemo(() => {
    if (!from) return [];
    const out: { key: string; list: Row[] }[] = [];
    const [y, m, d] = from.split("-").map(Number);
    const start = new Date(y, m - 1, d);
    const [ty, tm, td] = to.split("-").map(Number);
    const end = new Date(ty, tm - 1, td);
    for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
      const key = dstr(cur);
      out.push({ key, list: (rows ?? []).filter((r) => r.start_at.slice(0, 10) === key) });
    }
    return out;
  }, [from, to, rows]);

  const total = rows?.length ?? 0;
  const totalMinutes = (rows ?? []).reduce((s, r) => s + r.minutes, 0);
  const seatsOf = (r: Row) => (r.student_names ? r.student_names.split("、").length : 0);
  const totalSeats = (rows ?? []).reduce((s, r) => s + seatsOf(r), 0);

  const backHref = `/calendar?from=${from}`;

  return (
    <>
      <div className="page-head no-print">
        <div>
          <h1 className="page-title">课表打印</h1>
          <p className="page-sub">一页一周，纸上能看清时间、教室和人来齐了没有；直接「打印」或「另存为 PDF」</p>
        </div>
        <div className="page-head-actions">
          <a className="btn" href={backHref}>
            <Icon name="left" size={15} />
            回课表
          </a>
          <button className="btn btn-primary" onClick={() => window.print()}>
            <Icon name="printer" size={16} />
            打印 / 存 PDF
          </button>
        </div>
      </div>

      {error ? <div className="error-box no-print">{error}</div> : null}
      {!from ? (
        <PageLoading />
      ) : (
        <div className="print-sheet">
          <div className="print-sheet-head">
            <div>
              <h1>{org}</h1>
              <p className="print-sheet-sub">课程表</p>
            </div>
            <div className="print-sheet-meta">
              <div>
                {mdText(from)} — {mdText(to)}
              </div>
              <div>
                共 {total} 节 · {durationText(totalMinutes)} · {totalSeats} 人次
              </div>
            </div>
          </div>

          {days.map(({ key, list }) => {
            const [, , dd] = key.split("-").map(Number);
            const wd = WEEKDAYS[new Date(`${key}T00:00:00`).getDay()];
            return (
              <div key={key} className="print-day">
                <div className="print-day-head">
                  <span className="print-day-name">{mdText(key)}</span>
                  <span className="print-day-wd">
                    {wd} · {dd} 号
                  </span>
                  <span className="print-day-count">{list.length > 0 ? `${list.length} 节` : "无课"}</span>
                </div>
                {list.length === 0 ? (
                  <div className="print-empty">—</div>
                ) : (
                  <table className="print-table">
                    <thead>
                      <tr>
                        <th style={{ width: 96 }}>时间</th>
                        <th style={{ width: 130 }}>课程</th>
                        <th>内容 / 学生</th>
                        <th style={{ width: 80 }}>教室</th>
                        <th style={{ width: 60 }}>状态</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((r) => (
                        <tr key={r.id}>
                          <td className="nowrap">
                            {timeOf(r.start_at)}
                            <span className="print-dim"> +{r.minutes}′</span>
                          </td>
                          <td>{r.course_name}</td>
                          <td>
                            <div>{r.title ?? "—"}</div>
                            <div className="print-dim">
                              {r.student_names || "—"}
                            </div>
                          </td>
                          <td>{r.room || "—"}</td>
                          <td>{STATUS_CN[r.status] ?? r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}

          <div className="print-sheet-foot">
            <div className="print-note">
              备注：____________________________________________
            </div>
            <div className="print-dim">打印于 {dstr(new Date())} {new Date().toTimeString().slice(0, 5)}</div>
          </div>
        </div>
      )}
    </>
  );
}
