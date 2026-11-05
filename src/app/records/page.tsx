"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, Badge, Btn, Card, CardHead, Empty, Field, PageLoading, Section, Stat } from "@/components/ui";
import { Icon } from "@/components/icons";
import { api } from "@/lib/client";
import { ATT_CN, LESSON_STATUS_CN, dateOnly, durationText, relTime, timeOf } from "@/lib/format";

interface Row {
  lesson_id: number;
  student_id: number;
  student_name: string;
  grade: string | null;
  course_id: number;
  course_name: string;
  title: string | null;
  start_at: string;
  minutes: number;
  room: string | null;
  lesson_status: string;
  att_status: string | null;
  billed_minutes: number | null;
  note: string | null;
  topic: string | null;
}

interface Summary {
  rows: number;
  lessons: number;
  billedMinutes: number;
  present: number;
  makeup: number;
  leave: number;
  absent: number;
  unrecorded: number;
  cancelled: number;
}

interface StudentLite {
  id: number;
  name: string;
  status: string;
}

interface CourseLite {
  id: number;
  name: string;
}

const ATT_TONE: Record<string, "ok" | "warn" | "bad" | "violet" | "brand"> = {
  present: "ok",
  makeup: "violet",
  leave: "warn",
  absent: "bad",
};

const STATUS_TONE: Record<string, "ok" | "brand" | "bad"> = {
  done: "ok",
  planned: "brand",
  cancelled: "bad",
};

function dstr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function shiftDays(base: string, days: number): string {
  const [y, m, d] = base.split("-").map(Number);
  return dstr(new Date(y, m - 1, d + days));
}

export default function RecordsPage() {
  const today = useMemo(() => dstr(new Date()), []);
  const [from, setFrom] = useState(() => shiftDays(dstr(new Date()), -29));
  const [to, setTo] = useState(today);
  const [studentId, setStudentId] = useState(0);
  const [courseId, setCourseId] = useState(0);
  const [status, setStatus] = useState("");
  const [att, setAtt] = useState("");

  const [rows, setRows] = useState<Row[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [courses, setCourses] = useState<CourseLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const query = useCallback(() => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    if (studentId) q.set("studentId", String(studentId));
    if (courseId) q.set("courseId", String(courseId));
    if (status) q.set("status", status);
    if (att) q.set("att", att);
    return q.toString();
  }, [from, to, studentId, courseId, status, att]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<{ rows: Row[]; summary: Summary }>(`/api/records?${query()}`);
      setRows(data.rows);
      setSummary(data.summary);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const [s, c] = await Promise.all([api<StudentLite[]>("/api/students"), api<CourseLite[]>("/api/courses")]);
        setStudents(s);
        setCourses(c);
      } catch {
        /* 下拉没数据不影响主流程 */
      }
    })();
  }, []);

  function quick(days: number) {
    setFrom(shiftDays(today, -(days - 1)));
    setTo(today);
  }

  function monthRange() {
    setFrom(today.slice(0, 7) + "-01");
    setTo(today);
  }

  const rate = summary && summary.rows > 0
    ? Math.round(((summary.present + summary.makeup) / summary.rows) * 100)
    : 0;

  const exportUrl = `/api/export?scope=records&${query()}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">上课记录</h1>
          <p className="page-sub">谁在什么时候上了什么课、扣了多少课时，一页查完；点一行能回去补记</p>
        </div>
        <div className="page-head-actions">
          <Btn icon="download" onClick={() => window.open(exportUrl)}>
            导出这张表
          </Btn>
          <a className="btn btn-primary" href="/calendar">
            <Icon name="calendar" size={16} />
            去课表
          </a>
        </div>
      </div>

      <Card>
        <div style={{ padding: "14px 16px" }}>
          <div className="form-grid">
            <Field label="从">
              <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="到">
              <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
            <Field label="学生">
              <select className="select" value={studentId} onChange={(e) => setStudentId(Number(e.target.value))}>
                <option value={0}>全部学生</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.status === "left" ? "（已离开）" : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="课程">
              <select className="select" value={courseId} onChange={(e) => setCourseId(Number(e.target.value))}>
                <option value={0}>全部课程</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="row wrap between" style={{ gap: 10, marginTop: 12 }}>
            <div className="row wrap" style={{ gap: 6 }}>
              <span className="muted fs-sm">快捷：</span>
              <button className="btn btn-sm" onClick={() => quick(7)}>
                近 7 天
              </button>
              <button className="btn btn-sm" onClick={() => quick(30)}>
                近 30 天
              </button>
              <button className="btn btn-sm" onClick={monthRange}>
                本月
              </button>
            </div>
            <div className="segmented">
              {[
                { key: "", label: "全部" },
                { key: "done", label: "已记完" },
                { key: "planned", label: "待上课" },
                { key: "cancelled", label: "已取消" },
              ].map((it) => (
                <button key={it.key} className={status === it.key ? "on" : ""} onClick={() => setStatus(it.key)}>
                  {it.label}
                </button>
              ))}
            </div>
          </div>

          <div className="row wrap" style={{ gap: 6, marginTop: 10 }}>
            <span className="muted fs-sm">出勤：</span>
            {[
              { key: "", label: "不限" },
              { key: "present", label: "出勤" },
              { key: "makeup", label: "补课" },
              { key: "leave", label: "请假" },
              { key: "absent", label: "缺席" },
            ].map((it) => (
              <button
                key={it.key}
                className={`chip ${att === it.key ? "on" : ""}`}
                onClick={() => setAtt(it.key)}
              >
                {it.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {error ? <div className="error-box">{error}</div> : null}

      {summary ? (
        <div className="stat-grid">
          <Stat label="课节数" value={summary.lessons} unit="节" icon="calendar" foot={`${summary.rows} 条学生记录`} />
          <Stat label="扣课时" value={(summary.billedMinutes / 60).toFixed(1)} unit="小时" icon="clock" tone="violet" />
          <Stat
            label="出勤率"
            value={rate}
            unit="%"
            icon="check"
            tone={rate >= 90 ? "ok" : rate >= 70 ? "warn" : "bad"}
            foot={`出勤 ${summary.present} · 补课 ${summary.makeup} · 请假 ${summary.leave} · 缺席 ${summary.absent}`}
          />
          <Stat
            label="还没记"
            value={summary.unrecorded}
            unit="条"
            icon="alert"
            tone={summary.unrecorded > 0 ? "warn" : "ok"}
            foot={summary.cancelled > 0 ? `另有 ${summary.cancelled} 条已取消` : "都记完了"}
          />
        </div>
      ) : null}

      <Section title="明细" count={rows?.length ?? 0} actions={<span className="muted fs-sm">点一行进那节课</span>}>
        {loading && !rows ? (
          <PageLoading />
        ) : !rows || rows.length === 0 ? (
          <Card>
            <Empty
              icon="calendar"
              title="这段时间没有记录"
              text="换个时间范围，或者先去课表排一节课"
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
            <CardHead title="上课明细" sub={`${dateOnly(rows[rows.length - 1].start_at)} 至 ${dateOnly(rows[0].start_at)}`} />
            <div className="table-wrap">
              <table className="table clickable compact">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>学生</th>
                    <th>课程</th>
                    <th>教室</th>
                    <th>出勤</th>
                    <th className="nowrap">扣课时</th>
                    <th>状态</th>
                    <th>一句话</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={`${r.lesson_id}-${r.student_id}`} onClick={() => (window.location.href = `/lessons/${r.lesson_id}`)}>
                      <td className="nowrap">
                        <div className="cell-main">{timeOf(r.start_at)}</div>
                        <div className="cell-sub">{dateOnly(r.start_at)}</div>
                      </td>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <Avatar name={r.student_name} size="sm" />
                          <div>
                            <div className="cell-main">{r.student_name}</div>
                            <div className="cell-sub">{r.grade ?? "—"}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="cell-main">{r.course_name}</div>
                        <div className="cell-sub">{r.title ?? "—"}</div>
                      </td>
                      <td className="muted">{r.room || "—"}</td>
                      <td>
                        {r.att_status ? (
                          <Badge tone={ATT_TONE[r.att_status] ?? "brand"} dot>
                            {ATT_CN[r.att_status] ?? r.att_status}
                          </Badge>
                        ) : (
                          <span className="dim">未记</span>
                        )}
                      </td>
                      <td className="nowrap">
                        {r.billed_minutes ? (
                          <span className="strong">{durationText(r.billed_minutes)}</span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                      <td>
                        <Badge tone={STATUS_TONE[r.lesson_status] ?? "brand"}>
                          {LESSON_STATUS_CN[r.lesson_status] ?? r.lesson_status}
                        </Badge>
                      </td>
                      <td className="muted note-cell">
                        {r.note ? (
                          <span className="ellipsis" title={`${r.topic ? r.topic + "：" : ""}${r.note}`}>
                            {r.topic ? <b>{r.topic}：</b> : null}
                            {r.note}
                          </span>
                        ) : (
                          <span className="dim">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-foot row between">
              <span className="muted fs-sm">
                共 {summary?.lessons ?? 0} 节课、{rows.length} 条记录 · 最近更新 {relTime(rows[0].start_at)}
              </span>
              <span className="muted fs-sm">
                导出的是当前筛选结果
                <Icon name="download" size={13} style={{ marginLeft: 6, verticalAlign: "-2px" }} />
              </span>
            </div>
          </Card>
        )}
      </Section>
    </>
  );
}
