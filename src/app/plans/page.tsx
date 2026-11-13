"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { ImportModal } from "@/components/ImportModal";
import { Badge, Btn, Card, CardHead, Confirm, Empty, Field, Modal, PageLoading, SearchInput, Segmented, useDownload, useToast } from "@/components/ui";
import { api, del, patch, post } from "@/lib/client";
import { durationText } from "@/lib/format";
import { useAutoNew } from "@/lib/autoNew";
import { plainText, renderMarkdown } from "@/lib/markdown";

interface Plan {
  id: number;
  course_id: number | null;
  title: string;
  topic: string | null;
  content: string;
  minutes: number | null;
  tags: string | null;
  updated_at: string;
}

interface CourseLite {
  id: number;
  name: string;
}

const EMPTY_FORM = { title: "", courseId: 0, topic: "", content: "", minutes: "", tags: "" };

export default function PlansPage() {
  const toast = useToast();
  const download = useDownload();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [courses, setCourses] = useState<CourseLite[]>([]);
  const [q, setQ] = useState("");
  const [courseFilter, setCourseFilter] = useState(0);
  const [open, setOpen] = useState(false);
  useAutoNew(setOpen); // 顶栏「写教案」跳 ?new=1，直接把新建弹层打开
  const [editId, setEditId] = useState(0);
  const [detail, setDetail] = useState<Plan | null>(null);
  const [mdView, setMdView] = useState<"read" | "raw">("read");
  const [editPreview, setEditPreview] = useState(false);
  const [delId, setDelId] = useState(0);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [importOpen, setImportOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState("");
  const [aiNotes, setAiNotes] = useState("");
  const [aiBusy, setAiBusy] = useState(false);

  const load = useCallback(() => {
    api<Plan[]>("/api/plans")
      .then(setPlans)
      .catch((e: Error) => toast.bad(e.message));
  }, [toast]);

  useEffect(() => {
    load();
    api<CourseLite[]>("/api/courses").then(setCourses).catch(() => {});
  }, [load]);

  const filtered = useMemo(() => {
    let out = plans ?? [];
    if (courseFilter) out = out.filter((p) => p.course_id === courseFilter);
    const kw = q.trim();
    if (kw) {
      out = out.filter((p) => [p.title, p.topic, p.tags, p.content].filter(Boolean).some((v) => String(v).includes(kw)));
    }
    return out;
  }, [plans, q, courseFilter]);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of plans ?? []) {
      for (const t of String(p.tags ?? "").split(/[,，、\s]+/)) {
        if (t.trim()) set.add(t.trim());
      }
    }
    return [...set].slice(0, 12);
  }, [plans]);

  async function submit() {
    if (!form.title.trim()) {
      toast.bad("写个标题");
      return;
    }
    if (!form.content.trim()) {
      toast.bad("写点内容，哪怕几行要点");
      return;
    }
    setBusy(true);
    try {
      const body = {
        ...form,
        courseId: form.courseId || null,
        minutes: form.minutes ? Number(form.minutes) : null,
      };
      if (editId) {
        await patch(`/api/plans/${editId}`, body);
        toast.ok("教案已更新");
      } else {
        await post("/api/plans", body);
        toast.ok("教案已入库");
      }
      setOpen(false);
      setEditId(0);
      setForm(EMPTY_FORM);
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    try {
      await del(`/api/plans/${delId}`);
      toast.ok("已删除");
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setDelId(0);
    }
  }

  async function copyPlan(p: Plan) {
    try {
      await navigator.clipboard.writeText(p.content);
      toast.ok("内容已复制");
    } catch {
      toast.bad("复制失败");
    }
  }

  async function genDraft() {
    const topic = (aiTopic || form.topic || form.title).trim();
    if (!topic) {
      toast.bad("先写一句「想讲什么」");
      return;
    }
    setAiBusy(true);
    try {
      const course = courses.find((c) => c.id === form.courseId);
      const r = await post<{ ok: boolean; content?: string; error?: string }>("/api/plans/draft", {
        topic,
        subject: course?.name ?? "",
        minutes: Number(form.minutes) || undefined,
        notes: aiNotes,
      });
      if (!r.ok) {
        toast.bad(r.error || "AI 没回来，先自己写两句吧");
        return;
      }
      const text = r.content ?? "";
      const firstLine = text.split("\n").find((l) => l.trim()) ?? "";
      const guessTitle = firstLine.replace(/^#+\s*/, "").trim();
      setForm((f) => ({
        ...f,
        content: text,
        title: f.title.trim() ? f.title : guessTitle,
        topic: f.topic.trim() ? f.topic : topic,
      }));
      setEditPreview(false);
      setAiOpen(false);
      toast.ok("初稿放进「内容」了，改完记得保存");
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  if (!plans) return <PageLoading />;
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">备课</h1>
          <p className="page-sub">
            把讲义、例题、易错点存在这里，下次上课直接翻。已有 {plans.length} 篇。
          </p>
        </div>
        <div className="page-head-actions">
          <Btn icon="download" onClick={() => download("/api/export?scope=plans", "教案.json")}>
            导出
          </Btn>
          <Btn icon="upload" onClick={() => setImportOpen(true)}>
            导入
          </Btn>
          <Btn
            variant="primary"
            icon="plus"
            onClick={() => {
              setEditId(0);
              setForm(EMPTY_FORM);
              setOpen(true);
            }}
          >
            新教案
          </Btn>
        </div>
      </div>

      <Card>
        <div className="row wrap" style={{ gap: 10, padding: "12px 14px" }}>
          <SearchInput value={q} onChange={setQ} placeholder="搜标题、主题、标签、正文" style={{ maxWidth: 280 }} />
          <select
            className="select"
            value={courseFilter}
            onChange={(e) => setCourseFilter(Number(e.target.value))}
            style={{ width: 160 }}
          >
            <option value={0}>全部课程</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {allTags.length > 0 && (
            <div className="chip-list">
              {allTags.map((t) => (
                <button key={t} className={`chip ${q === t ? "on" : ""}`} onClick={() => setQ(q === t ? "" : t)}>
                  <Icon name="tag" size={12} />
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      </Card>

      {filtered.length === 0 ? (
        <Card>
          <Empty
            icon="book"
            title={plans.length === 0 ? "还没有教案" : "没找到符合条件的教案"}
            text={
              plans.length === 0
                ? "把常讲的题、常用的讲义放进来，上一次课就攒一篇"
                : "换个关键词，或者清掉筛选条件"
            }
            action={
              plans.length === 0 ? (
                <Btn
                  variant="primary"
                  icon="plus"
                  onClick={() => {
                    setEditId(0);
                    setForm(EMPTY_FORM);
                    setOpen(true);
                  }}
                >
                  写第一篇
                </Btn>
              ) : null
            }
          />
        </Card>
      ) : (
        <div className="grid g3">
          {filtered.map((p) => (
            <div key={p.id} className="plan-card" onClick={() => setDetail(p)} role="button">
              <h4>
                {p.title}
                {p.minutes ? <span className="muted fs-xs" style={{ marginLeft: 6 }}>{durationText(p.minutes)}</span> : null}
              </h4>
              <p>
                {p.topic ? p.topic + "：" : ""}
                {plainText(p.content, 90)}
              </p>
              <div className="row between" style={{ marginTop: 10 }}>
                <div className="chip-list">
                  {p.course_id ? (
                    <span className="badge badge-brand">{courses.find((c) => c.id === p.course_id)?.name ?? "课程"}</span>
                  ) : null}
                  {String(p.tags ?? "")
                    .split(/[,，、\s]+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((t) => (
                      <span key={t} className="badge badge-outline">
                        {t}
                      </span>
                    ))}
                </div>
                <span className="muted fs-xs">{p.updated_at.slice(5, 10)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新建/编辑 */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "编辑教案" : "新教案"}
        wide
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
          <Field label="标题" required>
            <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="如 三年级应用题：行程问题" autoFocus />
          </Field>
          <Field label="课程">
            <select className="select" value={form.courseId} onChange={(e) => setForm({ ...form, courseId: Number(e.target.value) })}>
              <option value={0}>不挂课程</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="主题" hint="一个词概括，如 行程问题">
            <input className="input" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
          </Field>
          <Field label="时长（分钟）">
            <input className="input" type="number" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} placeholder="可选" />
          </Field>
          <Field label="标签" hint="逗号分隔，方便搜">
            <input className="input" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="如 难点,常考" />
          </Field>
          <Field
            label="内容"
            required
            span2
            hint="讲义要点、例题、学生容易错的地方…… 支持 Markdown：# 标题、**加粗**、- 列表、> 引用"
          >
            <div className="row between" style={{ marginBottom: 6 }}>
              <Segmented
                items={[
                  { key: "write", label: "写" },
                  { key: "read", label: "看效果" },
                ]}
                value={editPreview ? "read" : "write"}
                onChange={(k) => setEditPreview(k === "read")}
              />
              <div className="row" style={{ gap: 10 }}>
                <span className="muted fs-xs">{form.content.length} 字</span>
                <Btn size="sm" icon="sparkles" onClick={() => setAiOpen((v) => !v)}>
                  AI 起个初稿
                </Btn>
              </div>
            </div>

            {aiOpen && (
              <div className="info-box" style={{ marginBottom: 8 }}>
                <div className="form-grid" style={{ gap: 10 }}>
                  <Field label="想讲什么" hint="越具体越好，会写进例题">
                    <input
                      className="input"
                      value={aiTopic}
                      onChange={(e) => setAiTopic(e.target.value)}
                      placeholder="如 两位数乘法的进位"
                    />
                  </Field>
                  <Field label="要求（可选）">
                    <input
                      className="input"
                      value={aiNotes}
                      onChange={(e) => setAiNotes(e.target.value)}
                      placeholder="如 学生基础弱，例题别太难"
                    />
                  </Field>
                </div>
                <div className="row between" style={{ marginTop: 8 }}>
                  <span className="muted fs-xs">
                    {aiBusy
                      ? "AI 正在写，接口慢的时候要等一两分钟…"
                      : "只是初稿，生成后写进下面的内容，你随便改；不点保存不会进库。"}
                  </span>
                  <Btn variant="primary" size="sm" icon="sparkles" loading={aiBusy} onClick={genDraft}>
                    生成初稿
                  </Btn>
                </div>
              </div>
            )}

            {editPreview ? (
              <div
                className="md-body scroll-y"
                style={{ maxHeight: 320, border: "1px solid var(--line)", borderRadius: "var(--r-2)", padding: "10px 12px" }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(form.content) || '<p class="md-empty">还没写内容</p>' }}
              />
            ) : (
              <textarea
                className="textarea mono"
                rows={12}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder={"1. 先复习速度、时间、路程\n2. 例题：…\n3. 易错点：…"}
              />
            )}
          </Field>
        </div>
      </Modal>

      {/* 详情 */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.title ?? ""}
        wide
        footer={
          detail && (
            <>
              <Btn icon="copy" onClick={() => copyPlan(detail)}>
                复制内容
              </Btn>
              <div className="spacer" />
              <Btn
                variant="danger"
                icon="trash"
                onClick={() => {
                  setDelId(detail.id);
                  setDetail(null);
                }}
              >
                删除
              </Btn>
              <Btn
                icon="edit"
                onClick={() => {
                  setEditId(detail.id);
                  setForm({
                    title: detail.title,
                    courseId: detail.course_id ?? 0,
                    topic: detail.topic ?? "",
                    content: detail.content,
                    minutes: detail.minutes ? String(detail.minutes) : "",
                    tags: detail.tags ?? "",
                  });
                  setDetail(null);
                  setOpen(true);
                }}
              >
                编辑
              </Btn>
            </>
          )
        }
      >
        {detail && (
          <>
            <div className="row between wrap" style={{ gap: 6, marginBottom: 12 }}>
              <div className="row wrap" style={{ gap: 6 }}>
                {detail.course_id ? (
                  <Badge tone="brand">{courses.find((c) => c.id === detail.course_id)?.name ?? ""}</Badge>
                ) : null}
                {detail.topic ? <Badge tone="outline">{detail.topic}</Badge> : null}
                {detail.minutes ? <Badge tone="cyan">{durationText(detail.minutes)}</Badge> : null}
                <span className="muted fs-xs">更新于 {detail.updated_at}</span>
              </div>
              <Segmented
                items={[
                  { key: "read", label: "预览" },
                  { key: "raw", label: "原文" },
                ]}
                value={mdView}
                onChange={setMdView}
              />
            </div>
            {mdView === "read" ? (
              <div
                className="md-body scroll-y"
                style={{ maxHeight: 480 }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(detail.content) }}
              />
            ) : (
              <pre className="mono scroll-y" style={{ whiteSpace: "pre-wrap", lineHeight: 1.8, fontSize: 13.5, margin: 0, maxHeight: 480 }}>
                {detail.content}
              </pre>
            )}
          </>
        )}
      </Modal>

      <Confirm
        open={!!delId}
        title="删除这篇教案？"
        text="删了就找不回来了。已经挂到课上的记录不受影响。"
        confirmText="删除"
        danger
        onConfirm={doDelete}
        onClose={() => setDelId(0)}
      />

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        scope="plans"
        title="导入教案"
        hint="把导出的「教案-….json」用记事本打开，全部内容贴进来。同名教案会跳过，不会覆盖。"
        onDone={load}
      />
    </>
  );
}
