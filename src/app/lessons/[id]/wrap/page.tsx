"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api, patch, post } from "@/lib/client";
import { ATT_CN, durationText, mdText, relTime, timeOf } from "@/lib/format";
import { Avatar, Badge, Btn, Card, PageLoading, Switch, useToast } from "@/components/ui";
import { Icon } from "@/components/icons";
import { MicButton } from "@/components/MicButton";

interface WrapStudent {
  student_id: number;
  name: string;
  grade: string | null;
  balance_minutes: number | null;
  att_status: string | null;
  billed_minutes: number | null;
  att_note: string | null;
  note: string | null;
  topic: string | null;
  level: number | null;
  draft: string | null;
  draft_id: number | null;
}

interface WrapData {
  lesson: {
    id: number;
    start_at: string;
    minutes: number;
    title: string | null;
    status: string;
    course_name: string;
    plan_id: number | null;
  };
  plan: { id: number; title: string | null; points: string[] } | null;
  students: WrapStudent[];
}

interface AiState {
  enabled: boolean;
  model: string;
  hasKey: boolean;
}

const ATT_TONE: Record<string, "ok" | "warn" | "bad" | "violet"> = {
  present: "ok",
  leave: "warn",
  absent: "bad",
  makeup: "violet",
};

/** 草稿框跟着内容长高，免得生成的那段话被折在框里看不见 */
function fitBox(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(560, el.scrollHeight) + "px";
}

/**
 * 下课收尾：系统逐个问「今天怎么样」，老师一句话，出来的是给家长看的那段话。
 * 上课内容不在这儿问 —— 它来自这节课挂的教案。
 */
export default function WrapPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params?.id);
  const router = useRouter();
  const toast = useToast();

  const [data, setData] = useState<WrapData | null>(null);
  const [loading, setLoading] = useState(true);

  const [ai, setAi] = useState<AiState>({ enabled: false, model: "", hasKey: false });
  const [useAi, setUseAi] = useState(false);

  const [briefs, setBriefs] = useState<Record<number, string>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [savedIds, setSavedIds] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [bulk, setBulk] = useState(false);
  const [sent, setSent] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    try {
      const d = await api<WrapData>(`/api/lessons/${id}/feedback`);
      setData(d);
      // 预填老师上次在这节课记的那一句话，能改
      const b: Record<number, string> = {};
      for (const s of d.students) b[s.student_id] = s.note ?? s.att_note ?? "";
      setBriefs((old) => ({ ...b, ...old }));
      // 之前生成/保存过的草稿直接带回来，重新打开不用再生成一遍
      setDrafts((old) => {
        const next = { ...old };
        for (const s of d.students) if (s.draft && next[s.student_id] === undefined) next[s.student_id] = s.draft;
        return next;
      });
      setSavedIds((old) => {
        const next = { ...old };
        for (const s of d.students) if (s.draft_id && next[s.student_id] === undefined) next[s.student_id] = s.draft_id;
        return next;
      });
    } catch (e) {
      toast.bad(e instanceof Error ? e.message : "读取失败");
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api<AiState>("/api/ai")
      .then((a) => {
        setAi(a);
        setUseAi(a.enabled && a.hasKey);
      })
      .catch(() => {});
  }, []);

  const dateStr = data?.lesson.start_at.slice(0, 10) ?? "";
  const pending = useMemo(
    () => (data ? data.students.filter((s) => !drafts[s.student_id]).length : 0),
    [data, drafts],
  );

  async function gen(s: WrapStudent) {
    setBusy((b) => ({ ...b, [s.student_id]: true }));
    try {
      const r = await post<{ content: string; ai: { used: boolean; reason: string } }>(
        `/api/lessons/${id}/feedback`,
        { studentId: s.student_id, brief: briefs[s.student_id] ?? "", useAi },
      );
      setDrafts((d) => ({ ...d, [s.student_id]: r.content }));
      if (useAi && !r.ai.used && r.ai.reason) toast.info(`${s.name}：${r.ai.reason}`);
    } catch (e) {
      toast.bad(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy((b) => ({ ...b, [s.student_id]: false }));
    }
  }

  async function genAll() {
    if (!data) return;
    setBulk(true);
    const todo = data.students.filter((s) => !drafts[s.student_id]);
    for (const s of todo) {
      // 顺序生成，避免一下子打满接口
      await gen(s);
    }
    setBulk(false);
    if (todo.length === 0) toast.info("已经都生成过了");
    else toast.ok(`生成了 ${todo.length} 段，逐段看一眼再发`);
  }

  async function saveDraft(s: WrapStudent) {
    const content = drafts[s.student_id] ?? "";
    if (!content.trim()) return;
    try {
      const r = await post<{ id: number; updated?: boolean }>("/api/feedback", {
        studentId: s.student_id,
        periodStart: dateStr,
        periodEnd: dateStr,
        content,
      });
      setSavedIds((m) => ({ ...m, [s.student_id]: r.id }));
      toast.ok(r.updated ? "草稿已更新" : "已存进草稿箱");
    } catch (e) {
      toast.bad(e instanceof Error ? e.message : "保存失败");
    }
  }

  async function markSent(s: WrapStudent) {
    const sid = savedIds[s.student_id];
    if (!sid) {
      toast.info("先存一下草稿，再标记已发");
      return;
    }
    try {
      await patch(`/api/feedback/${sid}`, { status: "sent" });
      setSent((m) => ({ ...m, [s.student_id]: true }));
      toast.ok(`记下了：${s.name} 的这段已发出`);
    } catch (e) {
      toast.bad(e instanceof Error ? e.message : "标记失败");
    }
  }

  async function copy(s: WrapStudent) {
    const text = drafts[s.student_id] ?? "";
    try {
      await navigator.clipboard.writeText(text);
      toast.ok("复制好了，去微信里粘贴吧");
    } catch {
      toast.bad("浏览器不让复制，手动选中吧");
    }
  }

  if (loading) return <PageLoading text="正在看这节课…" />;
  if (!data) return <Card>这节课不见了。</Card>;

  const { lesson, plan, students } = data;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">跟家长说一句</h1>
          <p className="page-sub">
            {mdText(dateStr)} {timeOf(lesson.start_at)} · {lesson.course_name} · {durationText(lesson.minutes)}
            <span className="muted">　上课内容已经在这了，你只要说孩子今天怎么样</span>
          </p>
        </div>
        <div className="page-head-actions">
          <Btn variant="ghost" icon="arrowLeft" onClick={() => router.push(`/lessons/${id}`)}>
            回到这节课
          </Btn>
          <Btn variant="primary" icon="sparkles" loading={bulk} onClick={genAll}>
            全部生成{pending > 0 ? `（${pending}）` : ""}
          </Btn>
        </div>
      </div>

      <Card className="mb-2">
        <div className="card-body">
          <div className="row between wrap">
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <span className="badge badge-brand dot">上课内容</span>
              <strong>{plan?.title || lesson.title || lesson.course_name}</strong>
              {!plan && (
                <span className="muted fs-sm">
                  这节课没挂教案，反馈里只会写课程名（
                  <Link href="/plans">去备课</Link>）
                </span>
              )}
            </div>
            {ai.enabled && ai.hasKey && (
              <Switch on={useAi} onChange={setUseAi} label={`用 AI（${ai.model}）润色`} />
            )}
          </div>
          {plan && plan.points.length > 0 && (
            <div className="chip-list mt-2">
              {plan.points.map((p) => (
                <span className="chip on" key={p}>
                  {p}
                </span>
              ))}
            </div>
          )}
          {plan && plan.points.length === 0 && (
            <p className="muted fs-sm mt-1">
              教案里没写小标题，反馈会直接用「{plan.title || lesson.course_name}」。在教案里加几行 <code>- 要点</code> 就能自动带出来。
            </p>
          )}
        </div>
      </Card>

      {students.length === 0 && (
        <Card>
          <div className="card-body muted">这节课没有学生。</div>
        </Card>
      )}

      <div className="grid" style={{ gap: 12 }}>
        {students.map((s) => {
          const draft = drafts[s.student_id];
          const att = s.att_status ?? "";
          return (
            <Card key={s.student_id}>
              <div className="card-head">
                <div className="row" style={{ gap: 10, alignItems: "center" }}>
                  <Avatar name={s.name} />
                  <div>
                    <div className="strong">{s.name}</div>
                    <div className="muted fs-sm">
                      {s.grade ? `${s.grade} · ` : ""}剩 {((s.balance_minutes ?? 0) / 60).toFixed(1).replace(/\.0$/, "")} 小时
                      {s.topic ? ` · 今天记的是「${s.topic}」` : ""}
                    </div>
                  </div>
                  {att && <Badge tone={ATT_TONE[att] ?? "outline"}>{ATT_CN[att] ?? att}</Badge>}
                  {s.billed_minutes ? <Badge tone="outline">扣 {(s.billed_minutes / 60).toFixed(1).replace(/\.0$/, "")} 小时</Badge> : null}
                </div>
                {sent[s.student_id] && <Badge tone="ok" dot>已发出</Badge>}
              </div>

              <div className="card-body">
                {!draft ? (
                  <>
                    <label className="field-label">今天他怎么样？</label>
                    <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                      <textarea
                        className="textarea grow"
                        rows={2}
                        placeholder={
                          att === "leave"
                            ? "请假了，可以不写；写了会出现在反馈里"
                            : "一句话就行：相遇问题会画线段图了，追及还是混"
                        }
                        value={briefs[s.student_id] ?? ""}
                        onChange={(e) =>
                          setBriefs((b) => ({ ...b, [s.student_id]: e.target.value }))
                        }
                      />
                      <MicButton
                        base={briefs[s.student_id] ?? ""}
                        onText={(t) => setBriefs((b) => ({ ...b, [s.student_id]: t }))}
                      />
                    </div>
                    <div className="row mt-2" style={{ gap: 8 }}>
                      <Btn
                        variant="primary"
                        icon="sparkles"
                        loading={busy[s.student_id]}
                        onClick={() => gen(s)}
                      >
                        生成这段
                      </Btn>
                      <span className="muted fs-sm self-center">
                        {busy[s.student_id] && useAi
                          ? "AI 正在写，接口慢的时候要等一两分钟…"
                          : "上课内容会自动带上，不用重复说"}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="row between">
                      <label className="field-label">给家长的话（可以改）</label>
                      <span className="muted fs-xs">{draft.length} 字</span>
                    </div>
                    <textarea
                      className="textarea"
                      rows={8}
                      ref={fitBox}
                      value={draft}
                      onChange={(e) => {
                        setDrafts((d) => ({ ...d, [s.student_id]: e.target.value }));
                        fitBox(e.currentTarget);
                      }}
                    />
                    <div className="row mt-2 wrap" style={{ gap: 8 }}>
                      <Btn icon="copy" onClick={() => copy(s)}>
                        复制
                      </Btn>
                      <Btn icon="save" onClick={() => saveDraft(s)}>
                        {savedIds[s.student_id] ? "更新草稿" : "存草稿"}
                      </Btn>
                      <Btn variant="soft" icon="send" onClick={() => markSent(s)}>
                        标记已发
                      </Btn>
                      <Btn
                        variant="ghost"
                        icon="refresh"
                        loading={busy[s.student_id]}
                        onClick={() => gen(s)}
                      >
                        重新生成
                      </Btn>
                      <div className="spacer" />
                      <Btn
                        variant="ghost"
                        onClick={() => setDrafts((d) => ({ ...d, [s.student_id]: "" }))}
                      >
                        不要这段
                      </Btn>
                    </div>
                  </>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="row between mt-3 wrap">
        <span className="muted fs-sm">
          <Icon name="info" size={14} /> 生成的是草稿，发之前自己读一遍；AI 只在设置里开了才会用，没开就是固定规则拼的。
        </span>
        <div className="row" style={{ gap: 8 }}>
          <Link className="btn btn-ghost" href="/feedback">
            去反馈草稿箱
          </Link>
          <Link className="btn btn-ghost" href="/">
            今天就到这儿
          </Link>
        </div>
      </div>

      <p className="muted fs-xs mt-2">
        这节课 {relTime(lesson.start_at)} 开始 · 状态 {lesson.status === "done" ? "已记完" : lesson.status}
      </p>
    </>
  );
}
