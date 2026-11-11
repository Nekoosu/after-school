"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import {
  Avatar,
  Badge,
  Btn,
  Card,
  CardHead,
  Confirm,
  Empty,
  Field,
  Modal,
  PageLoading,
  Stat,
  useToast,
} from "@/components/ui";
import { api, del, patch, post } from "@/lib/client";
import { durationText } from "@/lib/format";

interface Teacher {
  id: number;
  name: string;
  phone: string | null;
  subject: string | null;
  color: string | null;
  note: string | null;
  status: string;
  course_names: string | null;
  student_count: number;
  week_lessons: number;
  week_minutes: number;
}

interface CourseLite {
  id: number;
  name: string;
  teacher_id: number | null;
  teacher_name: string | null;
}

const COLORS = ["#7c5cff", "#2563eb", "#0f9d63", "#c2751a", "#dc3d43", "#0891b2", "#be185d"];

export default function TeachersPage() {
  const toast = useToast();
  const [list, setList] = useState<Teacher[] | null>(null);
  const [courses, setCourses] = useState<CourseLite[]>([]);
  const [busy, setBusy] = useState(false);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Teacher | null>(null);
  const [delTarget, setDelTarget] = useState<Teacher | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", subject: "", color: COLORS[0], note: "" });
  const [pickedCourses, setPickedCourses] = useState<number[]>([]);

  const load = useCallback(() => {
    api<Teacher[]>("/api/teachers")
      .then(setList)
      .catch((e: Error) => toast.bad(e.message));
    api<CourseLite[]>("/api/courses")
      .then(setCourses)
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openNew() {
    setEditing(null);
    setForm({ name: "", phone: "", subject: "", color: COLORS[0], note: "" });
    setPickedCourses([]);
    setOpen(true);
  }

  function openEdit(t: Teacher) {
    setEditing(t);
    setForm({
      name: t.name,
      phone: t.phone ?? "",
      subject: t.subject ?? "",
      color: t.color ?? COLORS[0],
      note: t.note ?? "",
    });
    // 这位老师现在带的课 = 课程表里 teacher_id 指向他的那些
    setPickedCourses(courses.filter((c) => c.teacher_id === t.id).map((c) => c.id));
    setOpen(true);
  }

  function toggleCourse(id: number) {
    setPickedCourses((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    if (!form.name.trim()) {
      toast.bad("先填老师名字");
      return;
    }
    setBusy(true);
    try {
      const body = {
        name: form.name.trim(),
        phone: form.phone || null,
        subject: form.subject || null,
        color: form.color,
        note: form.note || null,
        courseIds: pickedCourses,
      };
      if (editing) {
        await patch(`/api/teachers/${editing.id}`, body);
        toast.ok("已保存");
      } else {
        await post<Teacher>("/api/teachers", body);
        toast.ok(`已添加 ${body.name}`);
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleStatus(t: Teacher) {
    try {
      await patch(`/api/teachers/${t.id}`, { status: t.status === "active" ? "inactive" : "active" });
      toast.ok(t.status === "active" ? `${t.name} 已停用` : `${t.name} 已恢复`);
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    }
  }

  async function remove(t: Teacher) {
    try {
      const r = await del<{ soft?: boolean }>(`/api/teachers/${t.id}`);
      toast.ok(r?.soft ? `${t.name} 名下还有课，已改成停用（历史课的老师名不会丢）` : `${t.name} 已删除`);
      setDelTarget(null);
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    }
  }

  if (list === null) return <PageLoading />;

  const active = list.filter((t) => t.status === "active");
  const weekLessons = active.reduce((n, t) => n + t.week_lessons, 0);
  const weekMinutes = active.reduce((n, t) => n + t.week_minutes, 0);
  const unassigned = courses.filter((c) => !c.teacher_id);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">老师</h1>
          <p className="page-sub">登记老师、把课程挂到人名下；排课时就按老师判断冲不冲突</p>
        </div>
        <div className="page-head-actions">
          <Btn variant="primary" icon="plus" onClick={openNew}>
            添加老师
          </Btn>
        </div>
      </div>

      <div className="stat-grid">
        <Stat label="老师在岗" value={active.length} unit="位" icon="users" />
        <Stat label="本周课数" value={weekLessons} unit="节" icon="calendar" />
        <Stat label="本周课时" value={(weekMinutes / 60).toFixed(1)} unit="小时" icon="clock" />
        <Stat
          label="没挂老师的课"
          value={unassigned.length}
          unit="门"
          icon="alert"
          tone={unassigned.length > 0 ? "warn" : "ok"}
          foot={unassigned.length > 0 ? "挂上老师才查得出老师撞课" : "课程都有人了"}
        />
      </div>

      {list.length === 0 ? (
        <Empty
          icon="users"
          title="还没有登记老师"
          text="一个老师可以带好几门课；录入之后课表能按老师看，排课也会提醒老师时间撞车。"
          action={
            <Btn variant="primary" icon="plus" onClick={openNew}>
              添加第一位老师
            </Btn>
          }
        />
      ) : (
        <div className="teacher-grid">
          {list.map((t) => (
            <Card key={t.id} className={t.status === "inactive" ? "teacher-card off" : "teacher-card"}>
              <div className="teacher-head">
                <Avatar name={t.name} size="md" />
                <div className="grow">
                  <div className="row" style={{ gap: 6 }}>
                    <b className="strong">{t.name}</b>
                    {t.status === "inactive" ? <Badge>已停用</Badge> : null}
                  </div>
                  <div className="fs-sm muted">
                    {t.subject || "没写科目"}
                    {t.phone ? ` · ${t.phone}` : ""}
                  </div>
                </div>
              </div>

              <div className="teacher-courses">
                {t.course_names ? (
                  t.course_names.split("、").map((n) => (
                    <span key={n} className="chip" style={{ borderColor: t.color ?? undefined }}>
                      {n}
                    </span>
                  ))
                ) : (
                  <span className="fs-sm muted">还没挂课程</span>
                )}
              </div>

              <div className="teacher-stats">
                <div>
                  <span className="muted fs-xs">本周</span>
                  <b>{t.week_lessons} 节</b>
                  <span className="muted fs-xs">{durationText(t.week_minutes)}</span>
                </div>
                <div>
                  <span className="muted fs-xs">学生</span>
                  <b>{t.student_count} 人</b>
                </div>
              </div>

              {t.note ? <div className="fs-sm muted teacher-note">{t.note}</div> : null}

              <div className="teacher-actions">
                <a className="btn btn-sm" href={`/calendar?teacher=${t.id}`}>
                  <Icon name="calendar" size={14} />
                  看课表
                </a>
                <Btn size="sm" icon="edit" onClick={() => openEdit(t)}>
                  改
                </Btn>
                <Btn size="sm" variant="ghost" onClick={() => toggleStatus(t)}>
                  {t.status === "active" ? "停用" : "恢复"}
                </Btn>
                <Btn size="sm" variant="ghost" icon="trash" onClick={() => setDelTarget(t)} />
              </div>
            </Card>
          ))}
        </div>
      )}

      {unassigned.length > 0 ? (
        <Card>
          <CardHead
            title="这几门课还没挂老师"
            sub="挂上之后，排课时如果这位老师同时在别处上课，会当场提醒"
            icon="alert"
          />
          <div className="row wrap" style={{ gap: 8, padding: "0 14px 14px" }}>
            {unassigned.map((c) => (
              <span key={c.id} className="chip">
                {c.name}
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      {/* 新增 / 编辑老师 */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `改 ${editing.name} 的资料` : "添加老师"}
        wide
        footer={
          <>
            <Btn onClick={() => setOpen(false)}>取消</Btn>
            <Btn variant="primary" icon="check" loading={busy} onClick={save}>
              保存
            </Btn>
          </>
        }
      >
        <div className="form-grid">
          <Field label="名字" required>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 李老师" />
          </Field>
          <Field label="电话">
            <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="可选" />
          </Field>
          <Field label="科目">
            <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="如 数学 / 语文" />
          </Field>
          <Field label="标记色">
            <div className="row" style={{ gap: 6 }}>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-dot ${form.color === c ? "on" : ""}`}
                  style={{ background: c }}
                  onClick={() => setForm({ ...form, color: c })}
                />
              ))}
            </div>
          </Field>
          <Field label="任教课程" span2 hint="勾上的课程就归这位老师；排课时会默认带出这位老师">
            {courses.length === 0 ? (
              <div className="muted fs-sm">还没有课程，先去「课表」页排一节课，会把课程一起建好。</div>
            ) : (
              <div className="check-list scroll-y max-h-360">
                {courses.map((c) => {
                  const on = pickedCourses.includes(c.id);
                  const other = c.teacher_id && c.teacher_id !== editing?.id ? c.teacher_name : null;
                  return (
                    <button key={c.id} type="button" className={`check-row ${on ? "on" : ""}`} onClick={() => toggleCourse(c.id)}>
                      <span className="grow" style={{ textAlign: "left" }}>
                        <b>{c.name}</b>
                        {other ? <span className="muted fs-xs">　现在是 {other} 的课</span> : null}
                      </span>
                      {on ? <Icon name="check" size={15} /> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </Field>
          <Field label="备注" span2>
            <input className="input" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="可选" />
          </Field>
        </div>
      </Modal>

      <Confirm
        open={delTarget !== null}
        title={`删除 ${delTarget?.name ?? ""}？`}
        text={
          delTarget && delTarget.week_lessons > 0
            ? "这位老师名下已经有课，删除只会改成「停用」，历史课的老师名会保留。"
            : "没有排过课的老师会直接删除，课程会变成未分配。"
        }
        danger
        confirmText="删除"
        onClose={() => setDelTarget(null)}
        onConfirm={() => delTarget && remove(delTarget)}
      />
    </>
  );
}
