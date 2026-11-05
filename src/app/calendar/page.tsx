"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Btn, Card, Empty, Field, Modal, PageLoading, useToast } from "@/components/ui";
import { api, post } from "@/lib/client";
import { LESSON_STATUS_CN, durationText, mdText, timeOf } from "@/lib/format";

interface LessonItem {
  id: number;
  title: string | null;
  start_at: string;
  minutes: number;
  status: string;
  room: string | null;
  course_name: string;
  student_names: string | null;
}

interface StudentLite {
  id: number;
  name: string;
  grade: string | null;
  balance_minutes: number | null;
  status: string;
}

interface CourseLite {
  id: number;
  name: string;
  default_minutes: number;
}

const WEEK_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const MINUTES_OPTS = [45, 60, 90, 120, 180];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function dstr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // 周一为 0
  x.setDate(x.getDate() - day);
  return x;
}

type View = "week" | "month";

export default function CalendarPage() {
  const toast = useToast();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(() => new Date()); // 当前定位到的某天
  const [lessons, setLessons] = useState<LessonItem[] | null>(null);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [courses, setCourses] = useState<CourseLite[]>([]);
  const [loading, setLoading] = useState(true);

  // 排课弹窗
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newCourse, setNewCourse] = useState(false);
  const [form, setForm] = useState(() => ({
    date: dstr(new Date()),
    time: "16:30",
    minutes: 90,
    repeatWeeks: 1,
    courseId: 0,
    newCourseName: "",
    title: "",
    room: "",
    planId: 0,
  }));
  const [picked, setPicked] = useState<number[]>([]);
  const [plans, setPlans] = useState<Array<{ id: number; title: string; course_id: number | null }>>([]);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [liveConf, setLiveConf] = useState<Array<{ lesson_id: number; student_name: string; start_at: string; title: string }>>([]);
  const [copying, setCopying] = useState(false);

  const range = useMemo(() => {
    if (view === "week") {
      const mon = mondayOf(anchor);
      const sun = new Date(mon);
      sun.setDate(sun.getDate() + 6);
      return { from: dstr(mon), to: dstr(sun) };
    }
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { from: dstr(first), to: dstr(last) };
  }, [anchor, view]);

  const load = useCallback(() => {
    setLoading(true);
    api<LessonItem[]>(`/api/lessons?from=${range.from}&to=${range.to}`)
      .then(setLessons)
      .catch((e: Error) => toast.bad(e.message))
      .finally(() => setLoading(false));
  }, [range.from, range.to, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api<StudentLite[]>("/api/students")
      .then((r) => setStudents(r.filter((s) => s.status === "active")))
      .catch(() => {});
    api<CourseLite[]>("/api/courses")
      .then(setCourses)
      .catch(() => {});
    // ?new=1 ?student= ?date=
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("new") === "1") {
      const sid = sp.get("student");
      if (sid) setPicked([Number(sid)]);
      const date = sp.get("date");
      if (date) setAnchor(new Date(date + "T00:00:00"));
      setForm((f) => ({ ...f, date: date ?? dstr(new Date()) }));
      setOpen(true);
    } else if (sp.get("date")) {
      setAnchor(new Date(sp.get("date") + "T00:00:00"));
    }
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    api<Array<{ id: number; title: string; course_id: number | null }>>("/api/plans")
      .then(setPlans)
      .catch(() => {});
  }, [open]);

  // 边填边查冲突：时间或学生一动就查一次（250ms 防抖），不用等点保存
  useEffect(() => {
    if (!open || picked.length === 0 || !form.date || !form.time) {
      setLiveConf([]);
      return;
    }
    const t = setTimeout(() => {
      const startAt = `${form.date} ${form.time}`;
      fetch(
        `/api/lessons/conflicts?startAt=${encodeURIComponent(startAt)}&minutes=${form.minutes}&studentIds=${picked.join(",")}`,
      )
        .then((r) => r.json())
        .then((d) => setLiveConf(Array.isArray(d.conflicts) ? d.conflicts : []))
        .catch(() => setLiveConf([]));
    }, 250);
    return () => clearTimeout(t);
  }, [open, picked, form.date, form.time, form.minutes]);

  const byDay = useMemo(() => {
    const map = new Map<string, LessonItem[]>();
    for (const l of lessons ?? []) {
      const key = l.start_at.slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(l);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.start_at.localeCompare(b.start_at));
    return map;
  }, [lessons]);

  function shiftWeek(delta: number) {
    const d = new Date(anchor);
    d.setDate(d.getDate() + delta * 7);
    setAnchor(d);
  }
  function shiftMonth(delta: number) {
    setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1));
  }

  const weekDays = useMemo(() => {
    const mon = mondayOf(anchor);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [anchor]);

  const monthCells = useMemo(() => {
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const start = mondayOf(first);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [anchor]);

  const monthCounts = useMemo(() => {
    const map = new Map<string, { total: number; done: number }>();
    for (const l of lessons ?? []) {
      const key = l.start_at.slice(0, 10);
      const cur = map.get(key) ?? { total: 0, done: 0 };
      cur.total += 1;
      if (l.status === "done") cur.done += 1;
      map.set(key, cur);
    }
    return map;
  }, [lessons]);

  const todayKey = dstr(new Date());
  // 一门课程都还没有时，这个输入框就是「建新课程」——不能反过来要求先去选一门课
  const creatingCourse = newCourse || courses.length === 0;

  async function submit(force = false) {
    let courseId = form.courseId;
    if (creatingCourse) {
      const name = form.newCourseName.trim();
      if (!name) {
        toast.bad("先给课程起个名字");
        return;
      }
      setBusy(true);
      try {
        const c = await post<{ id: number }>("/api/courses", { name, defaultMinutes: form.minutes });
        courseId = c.id;
        setNewCourse(false);
        setForm((f) => ({ ...f, courseId: c.id }));
        setCourses(await api<CourseLite[]>("/api/courses"));
      } catch (e) {
        toast.bad((e as Error).message);
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    if (!courseId) {
      toast.bad("选一门课程");
      return;
    }
    if (picked.length === 0) {
      toast.bad("至少选一个学生");
      return;
    }
    setBusy(true);
    try {
      const startAt = `${form.date} ${form.time}`;
      const res = await fetch("/api/lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          startAt,
          minutes: form.minutes,
          studentIds: picked,
          title: form.title || undefined,
          room: form.room || undefined,
          planId: form.planId || undefined,
          repeatWeeks: form.repeatWeeks,
          force,
        }),
      });
      if (res.status === 409) {
        const body = (await res.json()) as { error?: string };
        const go = window.confirm(`${body.error ?? "时间冲突"}\n\n仍然保存${form.repeatWeeks > 1 ? `这 ${form.repeatWeeks} 周` : "这节课"}吗？`);
        if (go) {
          await submit(true);
          return;
        }
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `保存失败（${res.status}）`);
      }
      const saved = (await res.json().catch(() => ({}))) as { count?: number };
      const n = saved.count ?? 1;
      toast.ok(n > 1 ? `已排好 ${n} 节课，每周同一时间` : "已排好课");
      setOpen(false);
      setPicked([]);
      setNewCourse(false);
      setForm((f) => ({ ...f, title: "", newCourseName: "", repeatWeeks: 1 }));
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function pickStudent(id: number) {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  /** 拖着课换一天：时间不动，只改日期；撞课了问一句 */
  async function moveTo(id: number, day: string, force = false): Promise<void> {
    const l = lessons?.find((x) => x.id === id);
    if (!l) return;
    if (l.start_at.slice(0, 10) === day) return;
    const startAt = `${day} ${timeOf(l.start_at)}`;
    try {
      const res = await fetch(`/api/lessons/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startAt, force }),
      });
      if (res.status === 409) {
        const body = (await res.json()) as { error?: string };
        if (window.confirm(`${body.error ?? "时间冲突"}\n\n还是挪过去吗？`)) return moveTo(id, day, true);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `挪课失败（${res.status}）`);
      }
      toast.ok(`已挪到 ${mdText(day)}`);
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    }
  }

  const rangeLabel =
    view === "week"
      ? `${mdText(range.from)} — ${mdText(range.to)}`
      : `${anchor.getFullYear()} 年 ${anchor.getMonth() + 1} 月`;

  /** 复制本周的课到下周（同一时间、同一批学生），冲突的那节自动跳过 */
  async function copyWeek() {
    if (view !== "week") return;
    const nextMon = new Date(range.from.replace(/-/g, "/"));
    nextMon.setDate(nextMon.getDate() + 7);
    if (!window.confirm(`把这周（${rangeLabel}）的课原样复制到下周？\n同一时间、同一批学生；时间撞车的会自动跳过。`)) return;
    setCopying(true);
    try {
      const r = await post<{ copied: number; skipped: number; skippedTitles: string[] }>("/api/lessons/copy-week", {
        from: range.from,
        to: range.to,
      });
      if (r.skipped > 0) {
        toast.info(`复制了 ${r.copied} 节，跳过 ${r.skipped} 节（${r.skippedTitles[0] ?? "时间冲突"}${r.skipped > 1 ? " 等" : ""}）`);
      } else {
        toast.ok(`复制了 ${r.copied} 节到下周`);
      }
      // 复制完把视图跳到下周，让人直接看到结果
      setAnchor(nextMon);
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setCopying(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">课表</h1>
          <p className="page-sub">点空位直接排课；按住一节课拖到别的天，时间是原来的时间</p>
        </div>
        <div className="page-head-actions">
          {view === "week" ? (
            <Btn icon="copy" loading={copying} onClick={copyWeek} title="把这周的课原样复制到下周">
              复制到下周
            </Btn>
          ) : null}
          <a className="btn" href={`/api/calendar.ics?from=${range.from}&to=${range.to}`} title="下载 .ics，导进手机日历当提醒">
            <Icon name="calendar" size={16} />
            导出日历
          </a>
          <a className="btn" href={`/calendar/print?from=${range.from}&to=${range.to}`}>
            <Icon name="printer" size={16} />
            打印课表
          </a>
          <Btn variant="primary" icon="plus" onClick={() => setOpen(true)}>
            排课
          </Btn>
        </div>
      </div>

      {/* 屏幕上不再直接用整页打印，改去专门的打印页（一页一周、带教室和人名单） */}
      <div className="print-head">
        <h1>课表 · {rangeLabel}</h1>
        <p>共 {lessons?.length ?? 0} 节</p>
      </div>

      <Card>
        <div className="row wrap between" style={{ gap: 10, padding: "12px 14px" }}>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => (view === "week" ? shiftWeek(-1) : shiftMonth(-1))}>
              <Icon name="left" size={15} />
            </button>
            <button
              className="btn btn-sm"
              onClick={() => {
                setAnchor(new Date());
                setView("week");
              }}
            >
              今天
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => (view === "week" ? shiftWeek(1) : shiftMonth(1))}>
              <Icon name="right" size={15} />
            </button>
            <span className="strong" style={{ marginLeft: 6 }}>{rangeLabel}</span>
          </div>
          <div className="segmented">
            <button className={view === "week" ? "on" : ""} onClick={() => setView("week")}>
              周
            </button>
            <button className={view === "month" ? "on" : ""} onClick={() => setView("month")}>
              月
            </button>
          </div>
        </div>
      </Card>

      {loading && !lessons ? (
        <PageLoading />
      ) : view === "week" ? (
        <div className="week-grid">
          {weekDays.map((d, i) => {
            const key = dstr(d);
            const items = byDay.get(key) ?? [];
            const isToday = key === todayKey;
            return (
              <div key={key} className="day-col">
                <div className={`day-head ${isToday ? "today" : ""}`}>
                  <span className="dow">
                    {WEEK_CN[i]}
                    {items.length > 0 ? <span className="day-count">{items.length} 节</span> : null}
                  </span>
                  <span className="dnum">{d.getDate()}</span>
                </div>
                <div
                  className={`day-body ${isToday ? "today" : ""} ${dropKey === key ? "drop" : ""} ${items.length === 0 ? "empty" : ""}`}
                  onDragOver={(e) => {
                    if (dragId === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dropKey !== key) setDropKey(key);
                  }}
                  onDragLeave={(e) => {
                    if (e.currentTarget === e.target) setDropKey(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = Number(e.dataTransfer.getData("text/plain") || dragId);
                    setDropKey(null);
                    setDragId(null);
                    if (id) void moveTo(id, key);
                  }}
                >
                  {items.map((l) => (
                    <a
                      key={l.id}
                      href={`/lessons/${l.id}`}
                      className={`cal-chip status-${l.status} ${dragId === l.id ? "dragging" : ""}`}
                      draggable
                      title="按住可以拖到别的天，时间不变"
                      onDragStart={(e) => {
                        setDragId(l.id);
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", String(l.id));
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropKey(null);
                      }}
                    >
                      <span className="t">{timeOf(l.start_at)}</span>
                      <span className="n">{l.course_name}</span>
                      <span className="s">{l.student_names ?? ""}</span>
                    </a>
                  ))}
                  {items.length === 0 ? <div className="day-empty">没课</div> : null}
                  <button
                    className="cal-add"
                    onClick={() => {
                      setForm((f) => ({ ...f, date: key }));
                      setOpen(true);
                    }}
                  >
                    <Icon name="plus" size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card>
          <div className="month-grid">
            {WEEK_CN.map((w) => (
              <div key={w} className="month-dow">
                {w.replace("周", "")}
              </div>
            ))}
            {monthCells.map((d) => {
              const key = dstr(d);
              const inMonth = d.getMonth() === anchor.getMonth();
              const c = monthCounts.get(key);
              const items = byDay.get(key) ?? [];
              return (
                <button
                  key={key}
                  className={`month-cell ${inMonth ? "" : "out"} ${key === todayKey ? "today" : ""}`}
                  onClick={() => {
                    setAnchor(d);
                    setView("week");
                  }}
                  title={items.map((l) => `${timeOf(l.start_at)} ${l.course_name}`).join("\n")}
                >
                  <span className="mc-dnum">{d.getDate()}</span>
                  <span className="mc-dots">
                    {c
                      ? Array.from({ length: Math.min(c.total, 4) }, (_, k) => (
                          <i key={k} className={c.done > k ? "mc-dot done" : "mc-dot"} />
                        ))
                      : null}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* 排课 */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="排一节课"
        wide
        footer={
          <>
            <Btn onClick={() => setOpen(false)}>取消</Btn>
            <Btn variant="primary" icon="check" loading={busy} onClick={() => submit()}>
              保存
            </Btn>
          </>
        }
      >
        <div className="form-grid">
          <Field label="日期" required>
            <input className="input" type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </Field>
          <Field label="时间" required>
            <input className="input" type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          </Field>
          <Field label="时长">
            <select className="select" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })}>
              {MINUTES_OPTS.map((m) => (
                <option key={m} value={m}>
                  {durationText(m)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="重复排" hint={form.repeatWeeks > 1 ? `每周同一天同一时间，共 ${form.repeatWeeks} 周` : "只排这一次"}>
            <select
              className="select"
              value={form.repeatWeeks}
              onChange={(e) => setForm({ ...form, repeatWeeks: Number(e.target.value) })}
            >
              <option value={1}>只排这一次</option>
              <option value={2}>连着 2 周</option>
              <option value={4}>连着 4 周</option>
              <option value={8}>连着 8 周</option>
              <option value={12}>连着 12 周</option>
              <option value={16}>连着 16 周</option>
            </select>
          </Field>
          <Field
            label="课程"
            required
            hint={
              creatingCourse
                ? courses.length === 0
                  ? "还没有课程，直接起个名字，保存时一并建好"
                  : "新课程建好后就固定下来，下次可以直接选"
                : undefined
            }
          >
            {creatingCourse ? (
              <>
                <input
                  className="input"
                  value={form.newCourseName}
                  onChange={(e) => setForm({ ...form, newCourseName: e.target.value })}
                  placeholder="新课程名字，如 语文一对一"
                />
                {courses.length > 0 && (
                  <button className="btn btn-sm btn-ghost" style={{ marginTop: 6 }} onClick={() => setNewCourse(false)}>
                    <Icon name="left" size={13} />
                    从已有课程里选
                  </button>
                )}
              </>
            ) : (
              <>
                <select className="select" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: Number(e.target.value) })}>
                  <option value={0}>选择课程…</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button className="btn btn-sm btn-ghost" style={{ marginTop: 6 }} onClick={() => setNewCourse(true)}>
                  <Icon name="plus" size={13} />
                  新建课程
                </button>
              </>
            )}
          </Field>
          <Field label="标题">
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="可选，如 第三讲：应用题" />
          </Field>
          <Field label="教室">
            <input className="input" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="可选" />
          </Field>
          <Field label="用哪篇教案" span2 hint="选了之后，这节课的页面里能直接看到教案">
            <select className="select" value={form.planId} onChange={(e) => setForm({ ...form, planId: Number(e.target.value) })}>
              <option value={0}>不挂教案</option>
              {plans
                .filter((p) => !form.courseId || p.course_id === form.courseId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="上课学生" required span2 hint={`已选 ${picked.length} 人`}>
            {students.length === 0 ? (
              <div className="muted fs-sm">还没有在读学生，先去「学生」页添加。</div>
            ) : (
              <div className="check-list scroll-y max-h-360">
                {students.map((s) => {
                  const on = picked.includes(s.id);
                  return (
                    <button key={s.id} className={`check-row ${on ? "on" : ""}`} onClick={() => pickStudent(s.id)}>
                      <Avatar name={s.name} size="sm" />
                      <span className="grow" style={{ textAlign: "left" }}>
                        <b>{s.name}</b>
                        {s.grade ? <span className="muted fs-xs">　{s.grade}</span> : null}
                      </span>
                      {s.balance_minutes !== null && (s.balance_minutes ?? 0) < form.minutes ? (
                        <Badge tone="warn">课时不足</Badge>
                      ) : null}
                      {on ? <Icon name="check" size={15} /> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
        </div>

        {liveConf.length > 0 ? (
          <div className="warn-box" style={{ marginTop: 12, alignItems: "flex-start" }}>
            <Icon name="alert" size={15} />
            <div>
              <b>这个时间已经有人有课了</b>
              <div className="fs-sm" style={{ marginTop: 4 }}>
                {liveConf
                  .map((c) => `${c.student_name} ${c.start_at.slice(11)} 已有「${c.title}」`)
                  .join("；")}
              </div>
              <div className="fs-sm muted" style={{ marginTop: 4 }}>
                换个时间就不用管；确实要排在同一时段，保存时会再问你一次。
              </div>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
