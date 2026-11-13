"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Avatar, Badge, Btn, Card, CardHead, Confirm, Empty, Field, Modal, PageLoading, Section, useDownload, useToast } from "@/components/ui";
import { api, del, downloadFile, patch, post } from "@/lib/client";
import { ImportModal } from "@/components/ImportModal";
import { durationText, weekdayLabel } from "@/lib/format";
import { useAutoNew } from "@/lib/autoNew";

interface ClassItem {
  id: number;
  name: string;
  course_id: number;
  course_name: string;
  weekday: number | null;
  start_time: string | null;
  minutes: number | null;
  room: string | null;
  member_count: number;
  member_ids: string | null;
  member_names: string | null;
}

interface CourseLite {
  id: number;
  name: string;
  default_minutes: number;
}

interface StudentLite {
  id: number;
  name: string;
  grade: string | null;
  status: string;
}

const EMPTY_FORM = {
  name: "",
  courseId: 0,
  weekday: 1,
  startTime: "16:30",
  minutes: "90",
  room: "",
  studentIds: [] as number[],
};

export default function ClassesPage() {
  const toast = useToast();
  const download = useDownload();
  const [classes, setClasses] = useState<ClassItem[] | null>(null);
  const [courses, setCourses] = useState<CourseLite[]>([]);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [open, setOpen] = useState(false);
  useAutoNew(setOpen); // 顶栏「新建班级」跳 ?new=1，直接把新建弹层打开
  const [editId, setEditId] = useState(0);
  const [delId, setDelId] = useState(0);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(() => {
    api<ClassItem[]>("/api/classes")
      .then(setClasses)
      .catch((e: Error) => toast.bad(e.message));
  }, [toast]);

  useEffect(load, [load]);
  useEffect(() => {
    api<CourseLite[]>("/api/courses").then(setCourses).catch(() => {});
    api<StudentLite[]>("/api/students")
      .then((r) => setStudents(r.filter((s) => s.status === "active")))
      .catch(() => {});
  }, []);

  const memberNames = useMemo(
    () => (c: ClassItem) => (c.member_names ?? "").split("、").filter(Boolean),
    [],
  );

  function openNew() {
    setEditId(0);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(c: ClassItem) {
    setEditId(c.id);
    setForm({
      name: c.name,
      courseId: c.course_id,
      weekday: c.weekday ?? 1,
      startTime: c.start_time ?? "16:30",
      minutes: c.minutes ? String(c.minutes) : "90",
      room: c.room ?? "",
      studentIds: (c.member_ids ?? "").split(",").filter(Boolean).map(Number),
    });
    setOpen(true);
  }

  async function submit() {
    if (!form.name.trim()) {
      toast.bad("给班起个名字");
      return;
    }
    if (!form.courseId) {
      toast.bad("选一门课程");
      return;
    }
    setBusy(true);
    try {
      const body = { ...form, minutes: Number(form.minutes) || null };
      if (editId) {
        await patch(`/api/classes/${editId}`, body);
        toast.ok("班级已更新");
      } else {
        await post("/api/classes", body);
        toast.ok("班级已建好");
      }
      setOpen(false);
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    try {
      await del(`/api/classes/${delId}`);
      toast.ok("班级已删除，排过的课还在课表上");
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setDelId(0);
    }
  }

  /** 按班的固定时间，把下一周 7 天的课批量排上 */
  async function generateWeek() {
    const fixed = (classes ?? []).filter((c) => c.weekday !== null && c.start_time);
    if (fixed.length === 0) {
      toast.bad("先给班设置固定的上课时间（周几 + 几点）");
      return;
    }
    setGenerating(true);
    try {
      // 下周一
      const mon = new Date();
      mon.setDate(mon.getDate() + (8 - (mon.getDay() || 7)));
      const p = (n: number) => String(n).padStart(2, "0");
      const dstr = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;

      const conflicts: string[] = [];
      let created = 0;
      for (const c of fixed) {
        const day = new Date(mon);
        day.setDate(mon.getDate() + ((c.weekday as number) - 1));
        const studentIds = (c.member_ids ?? "").split(",").filter(Boolean).map(Number);
        if (studentIds.length === 0) continue;
        const res = await fetch("/api/lessons", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            courseId: c.course_id,
            startAt: `${dstr(day)} ${c.start_time}`,
            minutes: c.minutes ?? 90,
            studentIds,
            title: c.name,
            classId: c.id,
          }),
        });
        if (res.status === 201) {
          created++;
        } else if (res.status === 409) {
          conflicts.push(`${c.name}（${dstr(day)}）`);
        }
      }
      if (conflicts.length > 0) {
        const go = window.confirm(`有 ${conflicts.length} 节课时间撞了：\n${conflicts.join("\n")}\n\n仍然强排吗？`);
        if (go) {
          for (const c of fixed) {
            const day = new Date(mon);
            day.setDate(mon.getDate() + ((c.weekday as number) - 1));
            const studentIds = (c.member_ids ?? "").split(",").filter(Boolean).map(Number);
            if (studentIds.length === 0) continue;
            await fetch("/api/lessons", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                courseId: c.course_id,
                startAt: `${dstr(day)} ${c.start_time}`,
                minutes: c.minutes ?? 90,
                studentIds,
                title: c.name,
                classId: c.id,
                force: true,
              }),
            });
          }
          toast.ok("强排完成，去课表看看");
        } else {
          toast.info(`正常生成了 ${created} 节，撞车的没排`);
        }
      } else {
        toast.ok(`下周排了 ${created} 节课`);
      }
    } finally {
      setGenerating(false);
    }
  }

  if (!classes) return <PageLoading />;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">班级</h1>
          <p className="page-sub">把固定一起上课的学生放一个班，之后按班排课一键搞定。</p>
        </div>
        <div className="page-head-actions">
          <Btn icon="download" onClick={() => download("/api/export?scope=classes", "班级.json")}>
            导出
          </Btn>
          <Btn icon="upload" onClick={() => setImportOpen(true)}>
            导入
          </Btn>
          <Btn icon="zap" loading={generating} onClick={generateWeek} disabled={classes.length === 0}>
            生成下周课表
          </Btn>
          <Btn variant="primary" icon="plus" onClick={openNew}>
            建班
          </Btn>
        </div>
      </div>

      {classes.length === 0 ? (
        <Card>
          <Empty
            icon="users"
            title="还没有班级"
            text="比如「三年级数学 A 班」，把固定时间上课的学生放进来"
            action={
              <Btn variant="primary" icon="plus" onClick={openNew}>
                建第一个班
              </Btn>
            }
          />
        </Card>
      ) : (
        <div className="grid g3">
          {classes.map((c) => (
            <Card key={c.id}>
              <CardHead
                title={c.name}
                sub={c.course_name}
                actions={
                  <Btn
                    size="sm"
                    variant="ghost"
                    icon="edit"
                    onClick={() => openEdit(c)}
                  />
                }
              />
              <div className="card-body tight">
                <div className="row wrap" style={{ gap: 6 }}>
                  {c.weekday !== null && (
                    <Badge tone="brand">
                      {weekdayLabel(c.weekday)} {c.start_time ?? ""}
                    </Badge>
                  )}
                  {c.minutes ? <Badge tone="outline">{durationText(c.minutes)}</Badge> : null}
                  {c.room ? <Badge tone="outline">{c.room}</Badge> : null}
                </div>
                <div className="mt-2">
                  <div className="muted fs-xs mb-2">成员 · {c.member_count} 人</div>
                  {c.member_count === 0 ? (
                    <span className="muted fs-sm">还没加学生，点右上角编辑</span>
                  ) : (
                    <div className="col" style={{ gap: 6 }}>
                      {memberNames(c).map((n) => (
                        <div key={n} className="row" style={{ gap: 8 }}>
                          <Avatar name={n} size="sm" />
                          <span className="fs-sm">{n}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="card-foot">
                <Btn size="sm" variant="ghost" icon="edit" onClick={() => openEdit(c)}>
                  编辑
                </Btn>
                <div className="spacer" />
                <Btn size="sm" variant="ghost" icon="trash" onClick={() => setDelId(c.id)}>
                  删除
                </Btn>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "编辑班级" : "建班"}
        footer={
          <>
            <Btn onClick={() => setOpen(false)}>取消</Btn>
            <Btn variant="primary" loading={busy} onClick={submit}>
              保存
            </Btn>
          </>
        }
      >
        <div className="form-grid">
          <Field label="班名" required>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如 三年级数学 A 班" autoFocus />
          </Field>
          <Field label="课程" required>
            <select className="select" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: Number(e.target.value) })}>
              <option value={0}>选择课程…</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="固定上课时间" hint="设置了才能一键生成周课表">
            <div className="row" style={{ gap: 6 }}>
              <select className="select" value={form.weekday} onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })} style={{ width: 110 }}>
                {[1, 2, 3, 4, 5, 6, 0].map((w) => (
                  <option key={w} value={w}>
                    {weekdayLabel(w)}
                  </option>
                ))}
              </select>
              <input className="input" type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} />
            </div>
          </Field>
          <Field label="时长（分钟）">
            <input className="input" type="number" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
          </Field>
          <Field label="教室" span2>
            <input className="input" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="可选" />
          </Field>
          <Field label={`学生（${form.studentIds.length} 人）`} span2>
            <div className="col scroll-y" style={{ gap: 6, maxHeight: 240 }}>
              {students.map((s) => {
                const on = form.studentIds.includes(s.id);
                return (
                  <button
                    key={s.id}
                    className={`check-row ${on ? "on" : ""}`}
                    onClick={() =>
                      setForm({
                        ...form,
                        studentIds: on ? form.studentIds.filter((x) => x !== s.id) : [...form.studentIds, s.id],
                      })
                    }
                  >
                    <Avatar name={s.name} size="sm" />
                    <span>
                      {s.name}
                      {s.grade ? <span className="muted fs-xs" style={{ marginLeft: 6 }}>{s.grade}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </Field>
        </div>
      </Modal>

      <Confirm
        open={!!delId}
        title="删除这个班？"
        text="班级记录和成员关系会删掉，但已经排到课表上的课还在。"
        confirmText="删除"
        danger
        onConfirm={doDelete}
        onClose={() => setDelId(0)}
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        scope="classes"
        title="导入班级"
        hint="把导出的「班级-….json」贴进来。同名同时间的班跳过；成员按名字找学生，找不到的会在结果里列出来。"
        onDone={load}
      />
    </>
  );
}
