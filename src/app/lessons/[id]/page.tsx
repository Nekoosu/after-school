"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { MicButton } from "@/components/MicButton";
import { Avatar, Badge, Btn, Card, Confirm, Empty, Field, Modal, PageLoading, useToast } from "@/components/ui";
import { api, del, patch, post } from "@/lib/client";
import { renderMarkdown } from "@/lib/markdown";
import {
  ATT_CN,
  LESSON_STATUS_CN,
  LEVEL_CN,
  NOTE_KIND_CN,
  QUICK_TAGS,
  durationText,
  timeOf,
  toHours,
} from "@/lib/format";

interface LessonStudent {
  student_id: number;
  name: string;
  grade: string | null;
  balance_minutes: number;
  att_status: string | null;
  billed_minutes: number | null;
  att_note: string | null;
  /** 这节的单价（元/小时）；已记账取真实值，未记则是按规则估的 */
  unit_price: number | null;
  /** 已经记账的真实课消金额；null = 还没记账 */
  charge_amount: number | null;
  /** 还没记账时，按「出勤」估的课消金额 */
  charge_estimate: number | null;
}

interface LessonDetail {
  lesson: {
    id: number;
    course_id: number;
    title: string | null;
    start_at: string;
    minutes: number;
    room: string | null;
    status: string;
    note: string | null;
    plan_id: number | null;
    course_name?: string;
    teacher_name?: string | null;
  };
  students: LessonStudent[];
  notes: Array<{ id: number; student_id: number; kind: string; content: string; created_at: string; level: number | null }>;
}

interface PlanLite {
  id: number;
  title: string;
  topic: string | null;
  content: string;
  minutes: number | null;
}

type AttStatus = "present" | "makeup" | "leave" | "absent";

const ATT_OPTS: Array<{ key: AttStatus; label: string; hint: string }> = [
  { key: "present", label: "出勤", hint: "扣课时" },
  { key: "makeup", label: "补课", hint: "扣课时" },
  { key: "leave", label: "请假", hint: "不扣，待补" },
  { key: "absent", label: "缺席", hint: "不扣，不补" },
];

interface RowState {
  status: AttStatus;
  note: string;
  topic: string;
  level: number;
}

export default function LessonPage() {
  const { id } = useParams<{ id: string }>();
  const lid = Number(id);
  const router = useRouter();
  const toast = useToast();
  // 正在填的这门课的草稿：关窗口/断电都不丢，下次进来接着填
  const draftKey = `as-draft-lesson-${lid}`;

  const [data, setData] = useState<LessonDetail | null>(null);
  const [plan, setPlan] = useState<PlanLite | null>(null);
  const [planOpen, setPlanOpen] = useState(true);
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [topics, setTopics] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ title: "", startAt: "", minutes: 90, room: "" });

  const load = () =>
    api<LessonDetail>(`/api/lessons/${lid}`)
      .then((d) => {
        setData(d);
        const init: Record<number, RowState> = {};
        for (const s of d.students) {
          init[s.student_id] = {
            status: (s.att_status as AttStatus) ?? "present",
            note: s.att_note ?? "",
            topic: "",
            level: 3,
          };
        }
        // 上次没记完的内容（手滑关了窗口、电脑重启）从本机草稿里捡回来
        try {
          const raw = d.lesson.status === "done" ? null : localStorage.getItem(draftKey);
          if (raw) {
            const saved = JSON.parse(raw) as { ids?: string; rows?: Record<string, RowState> };
            const ids = d.students.map((s) => s.student_id).join(",");
            if (saved?.ids === ids && saved.rows) {
              let used = false;
              for (const s of d.students) {
                const s2 = saved.rows[String(s.student_id)];
                if (!s2) continue;
                const base = init[s.student_id];
                if (!base) continue;
                init[s.student_id] = {
                  status: s2.status ?? base.status,
                  note: s2.note ?? base.note,
                  topic: s2.topic ?? base.topic,
                  level: s2.level ?? base.level,
                };
                if ((s2.note ?? "").trim()) used = true;
              }
              if (used) toast.info("已恢复上次没记完的内容");
            }
          }
        } catch {
          // 草稿坏了就当没有
        }
        setRows(init);
        if (d.lesson.plan_id) {
          api<PlanLite>(`/api/plans/${d.lesson.plan_id}`)
            .then(setPlan)
            .catch(() => setPlan(null));
        } else {
          setPlan(null);
        }
        setEditForm({
          title: d.lesson.title ?? "",
          startAt: d.lesson.start_at,
          minutes: d.lesson.minutes,
          room: d.lesson.room ?? "",
        });
      })
      .catch((e: Error) => setErr(e.message));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lid]);

  // 知识点候选：以前记过的，写的时候能选，避免同一个知识点写成好几种
  useEffect(() => {
    api<Array<{ topic: string }>>("/api/topics")
      .then((r) => setTopics(r.map((x) => x.topic)))
      .catch(() => {});
  }, []);

  // 每敲一个字都存一份本机草稿（体积很小，不会卡）；记完就清掉
  useEffect(() => {
    if (!data || data.lesson.status === "done") return;
    if (Object.keys(rows).length === 0) return;
    try {
      const ids = data.students.map((s) => s.student_id).join(",");
      localStorage.setItem(draftKey, JSON.stringify({ ids, rows, at: new Date().toISOString() }));
    } catch {
      // 隐私模式或空间满了：丢草稿可以接受，正事不耽误
    }
  }, [rows, data, draftKey]);

  const done = data?.lesson.status === "done";

  const summary = useMemo(() => {
    if (!data) return { count: 0, minutes: 0, notes: 0 };
    let count = 0;
    let minutes = 0;
    let notes = 0;
    for (const s of data.students) {
      const r = rows[s.student_id];
      if (!r) continue;
      if (r.status === "present" || r.status === "makeup") {
        count += 1;
        minutes += data.lesson.minutes;
      }
      if (r.note.trim()) notes += 1;
    }
    return { count, minutes, notes };
  }, [data, rows]);

  if (err) return <div className="error-box">加载失败：{err}</div>;
  if (!data) return <PageLoading />;

  const l = data.lesson;

  async function finish() {
    setBusy(true);
    try {
      const items = data!.students.map((s) => ({
        studentId: s.student_id,
        status: rows[s.student_id]?.status ?? "present",
        note: rows[s.student_id]?.note?.trim() || undefined,
        topic: rows[s.student_id]?.topic?.trim() || undefined,
        level: rows[s.student_id]?.note?.trim() ? (rows[s.student_id]?.level ?? 3) : undefined,
      }));
      const res = await post<{ billedTotal: number; noteCount: number }>(`/api/lessons/${lid}/finish`, { items });
      toast.ok(`已记完：扣课时 ${durationText(res.billedTotal)}，写入学情 ${res.noteCount} 条`);
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // 清不掉也无所谓，下次进来这门课已经 done，不会恢复
      }
      // 记完直接接着问「今天每个孩子怎么样」——上课内容已经在备课里了
      router.push(`/lessons/${lid}/wrap`);
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelLesson() {
    setBusy(true);
    try {
      await patch(`/api/lessons/${lid}`, { status: "cancelled" });
      toast.ok("这节课已取消");
      await load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function restoreLesson() {
    setBusy(true);
    try {
      await patch(`/api/lessons/${lid}`, { status: "planned" });
      toast.ok("已恢复");
      await load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeLesson() {
    setBusy(true);
    try {
      await del(`/api/lessons/${lid}`);
      toast.ok("已删除");
      router.push("/calendar");
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    setBusy(true);
    try {
      await patch(`/api/lessons/${lid}`, editForm);
      toast.ok("已保存");
      setEditOpen(false);
      await load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copyPlan() {
    if (!plan) return;
    try {
      await navigator.clipboard.writeText(plan.content);
      toast.ok("教案已复制");
    } catch {
      toast.bad("复制失败");
    }
  }

  function addTag(sid: number, tag: string) {
    setRows((prev) => {
      const cur = prev[sid] ?? { status: "present" as AttStatus, note: "" };
      const note = cur.note.includes(tag) ? cur.note : (cur.note ? cur.note + "，" : "") + tag;
      return { ...prev, [sid]: { ...cur, note } };
    });
  }

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <Link href="/calendar" className="btn btn-sm btn-ghost">
              <Icon name="left" size={14} />
              课表
            </Link>
            <Badge tone={done ? "done" : l.status === "cancelled" ? "cancelled" : "planned"}>
              {LESSON_STATUS_CN[l.status] ?? l.status}
            </Badge>
          </div>
          <h1 className="page-title">
            {l.course_name ?? "课程"}
            {l.title ? <span className="dim"> · {l.title}</span> : null}
          </h1>
          <p className="page-sub">
            {l.start_at.slice(0, 10)}　{timeOf(l.start_at)}　·　{durationText(l.minutes)}　·　
            {l.teacher_name ? `${l.teacher_name}　·　` : ""}
            {l.room ? `${l.room}　·　` : ""}
            {data.students.length} 人
          </p>
        </div>
        <div className="page-head-actions">
          {done && (
            <Btn variant="primary" icon="message" onClick={() => router.push(`/lessons/${lid}/wrap`)}>
              跟家长说一句
            </Btn>
          )}
          {!done && (
            <Btn icon="edit" onClick={() => setEditOpen(true)}>
              改时间
            </Btn>
          )}
          {l.status === "cancelled" ? (
            <Btn icon="refresh" onClick={restoreLesson} loading={busy}>
              恢复
            </Btn>
          ) : (
            !done && (
              <Btn icon="x" onClick={cancelLesson} loading={busy}>
                取消课
              </Btn>
            )
          )}
          {!done && (
            <Btn variant="danger" icon="trash" onClick={() => setDelOpen(true)}>
              删除
            </Btn>
          )}
        </div>
      </div>

      {l.status === "cancelled" && (
        <div className="warn-box" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={16} />
          <span>这节课已取消，不会出现在课表上，也不会扣课时。</span>
        </div>
      )}

      {plan && (
        <Card>
          <div className="card-head">
            <div>
              <div className="card-title">
                <Icon name="book" size={15} /> 这节课的教案：{plan.title}
              </div>
              <div className="card-sub">{plan.topic ?? ""}</div>
            </div>
            <div className="card-actions">
              <Btn size="sm" variant="ghost" icon={planOpen ? "up" : "down"} onClick={() => setPlanOpen((v) => !v)}>
                {planOpen ? "收起" : "展开"}
              </Btn>
              <Btn size="sm" variant="ghost" icon="copy" onClick={() => copyPlan()} />
            </div>
          </div>
          {planOpen && (
            <div className="card-body">
              <div
                className="md-body scroll-y"
                style={{ maxHeight: 360 }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(plan.content) }}
              />
            </div>
          )}
        </Card>
      )}

      {done ? (
        <Card>
          <div className="card-head">
            <div>
              <div className="card-title">这节课已记完</div>
              <div className="card-sub">课时已扣，学情已写入。要改只能去学生页手动调整。</div>
            </div>
            <Badge tone="done">已记完</Badge>
          </div>
          <div className="table-wrap">
            <table className="table compact">
              <thead>
                <tr>
                  <th>学生</th>
                  <th>出勤</th>
                  <th>扣课时</th>
                  <th>记录</th>
                </tr>
              </thead>
              <tbody>
                {data.students.map((s) => (
                  <tr key={s.student_id}>
                    <td>
                      <Link href={`/students/${s.student_id}`} className="row" style={{ gap: 8 }}>
                        <Avatar name={s.name} size="sm" />
                        {s.name}
                      </Link>
                    </td>
                    <td>
                      <Badge tone={s.att_status === "present" ? "present" : s.att_status === "makeup" ? "makeup" : s.att_status === "leave" ? "leave" : "absent"}>
                        {ATT_CN[s.att_status ?? ""] ?? s.att_status ?? "—"}
                      </Badge>
                    </td>
                    <td className="fs-sm nowrap">{s.billed_minutes ? `${s.billed_minutes} 分钟` : "—"}</td>
                    <td className="fs-sm muted">{s.att_note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.notes.length > 0 && (
            <div className="card-body">
              <div className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>这节课写下的学情</div>
              <div className="timeline">
                {data.notes.map((n) => (
                  <div key={n.id} className="tl-item brand">
                    <div className="tl-meta">
                      <b>{data.students.find((s) => s.student_id === n.student_id)?.name ?? ""}</b>
                      <span>{NOTE_KIND_CN[n.kind] ?? n.kind}</span>
                      {n.level ? <Badge tone="outline">{LEVEL_CN[n.level]}</Badge> : null}
                    </div>
                    <div className="tl-text">{n.content}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      ) : (
        <>
          {data.students.length === 0 ? (
            <Card>
              <Empty icon="users" title="这节课还没有学生" text="去课表里编辑这节课，把学生加进来" />
            </Card>
          ) : (
            <div className="col">
              {data.students.map((s) => {
                const r = rows[s.student_id] ?? { status: "present" as AttStatus, note: "" };
                const noBal = r.status === "present" || r.status === "makeup" ? s.balance_minutes < l.minutes : false;
                // 这节课这个人要扣多少钱：已记完取真实值，没记完取按规则估的
                const billedNow = r.status === "present" || r.status === "makeup";
                const charge = s.charge_amount ?? s.charge_estimate;
                return (
                  <Card key={s.student_id}>
                    <div className="card-body">
                      <div className="row" style={{ gap: 12, alignItems: "center", marginBottom: 12 }}>
                        <Avatar name={s.name} />
                        <div className="grow">
                          <div className="row" style={{ gap: 8 }}>
                            <b style={{ fontSize: 15 }}>{s.name}</b>
                            {s.grade ? <span className="muted fs-sm">{s.grade}</span> : null}
                          </div>
                          <div className="fs-sm muted">
                            剩余 <b className={noBal ? "danger" : ""}>{toHours(s.balance_minutes)}</b> 小时
                            {noBal ? <span className="danger">　课时不够扣一次了，记得提醒续费</span> : null}
                          </div>
                          {billedNow && charge !== null ? (
                            <div className="fs-sm muted">
                              本次课消 <b className="strong">￥{charge}</b>
                              {s.unit_price ? `　·　${s.unit_price} 元/小时` : ""}
                              {s.charge_amount === null ? <span className="dim">　（记完才落地）</span> : null}
                            </div>
                          ) : null}
                        </div>
                        <Link href={`/students/${s.student_id}`} className="btn btn-sm btn-ghost">
                          详情
                        </Link>
                      </div>

                      <div className="att-opts">
                        {ATT_OPTS.map((o) => (
                          <button
                            key={o.key}
                            className={`att-opt ${r.status === o.key ? `on-${o.key}` : ""}`}
                            onClick={() => setRows((prev) => ({ ...prev, [s.student_id]: { ...r, status: o.key } }))}
                          >
                            <span className="att-name">{o.label}</span>
                            <span className="att-hint">{o.hint}</span>
                          </button>
                        ))}
                      </div>

                      <div className="mt-2">
                        <div className="row" style={{ gap: 6 }}>
                          <input
                            className="input grow"
                            value={r.note}
                            onChange={(e) => setRows((prev) => ({ ...prev, [s.student_id]: { ...r, note: e.target.value } }))}
                            placeholder="一句话：今天状态怎么样、哪里卡住了"
                          />
                          <MicButton
                            base={r.note}
                            onText={(t) =>
                              setRows((prev) => ({ ...prev, [s.student_id]: { ...r, note: t } }))
                            }
                          />
                        </div>
                        <div className="chip-list" style={{ marginTop: 8 }}>
                          {QUICK_TAGS.slice(0, 6).map((t) => (
                            <button key={t} className="chip" onClick={() => addTag(s.student_id, t)}>
                              + {t}
                            </button>
                          ))}
                        </div>
                        {r.note.trim() ? (
                          <div className="row wrap" style={{ gap: 8, marginTop: 8 }}>
                            <input
                              className="input"
                              style={{ maxWidth: 240 }}
                              list="topic-opts"
                              value={r.topic}
                              onChange={(e) =>
                                setRows((prev) => ({ ...prev, [s.student_id]: { ...r, topic: e.target.value } }))
                              }
                              placeholder="知识点：这次讲的是什么"
                            />
                            <div className="segmented">
                              {[1, 2, 3, 4].map((lv) => (
                                <button
                                  key={lv}
                                  className={r.level === lv ? "on" : ""}
                                  onClick={() => setRows((prev) => ({ ...prev, [s.student_id]: { ...r, level: lv } }))}
                                >
                                  {LEVEL_CN[lv]}
                                </button>
                              ))}
                            </div>
                          </div>
                        ) : (
                          <div className="fs-xs muted" style={{ marginTop: 8 }}>
                            写一句话后，可以顺手标上这次讲的知识点和状态，攒下来就是掌握度
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          <Card>
            <div className="card-foot row between" style={{ padding: "12px 16px" }}>
              <div className="fs-sm muted">
                {summary.count} 人扣课时，共 <b className="strong">{durationText(summary.minutes)}</b>
                {summary.notes ? `　·　会写 ${summary.notes} 条学情` : ""}
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Btn onClick={() => router.push("/calendar")}>以后再说</Btn>
                <Btn variant="primary" icon="check" loading={busy} onClick={finish} disabled={data.students.length === 0}>
                  记完了
                </Btn>
              </div>
            </div>
          </Card>
        </>
      )}

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="改这节课"
        footer={
          <>
            <Btn onClick={() => setEditOpen(false)}>取消</Btn>
            <Btn variant="primary" loading={busy} onClick={saveEdit}>保存</Btn>
          </>
        }
      >
        <div className="form-grid">
          <Field label="标题">
            <input className="input" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} placeholder="可选" />
          </Field>
          <Field label="教室">
            <input className="input" value={editForm.room} onChange={(e) => setEditForm({ ...editForm, room: e.target.value })} placeholder="可选" />
          </Field>
          <Field label="开始时间" hint="格式：2026-11-04 16:30">
            <input className="input" value={editForm.startAt} onChange={(e) => setEditForm({ ...editForm, startAt: e.target.value })} />
          </Field>
          <Field label="时长（分钟）">
            <input
              className="input"
              type="number"
              value={editForm.minutes}
              onChange={(e) => setEditForm({ ...editForm, minutes: Number(e.target.value) })}
            />
          </Field>
        </div>
      </Modal>

      <Confirm
        open={delOpen}
        title="删除这节课？"
        text="删除后无法恢复。如果只是不上课了，用「取消课」更合适。"
        confirmText="删除"
        danger
        onConfirm={removeLesson}
        onClose={() => setDelOpen(false)}
      />

      <datalist id="topic-opts">
        {topics.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </>
  );
}
