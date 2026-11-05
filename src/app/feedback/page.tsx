"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Btn, Card, CardHead, Confirm, Empty, Field, Modal, PageLoading, Section, Switch, Tabs, useToast } from "@/components/ui";
import { api, del, patch, post } from "@/lib/client";
import { relTime } from "@/lib/format";

interface FeedbackRow {
  id: number;
  student_id: number;
  student_name: string;
  period_start: string;
  period_end: string;
  content: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}

interface StudentLite {
  id: number;
  name: string;
  grade: string | null;
  status: string;
}

function mondayOf(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function dstr(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function FeedbackPage() {
  const toast = useToast();
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [tab, setTab] = useState<"draft" | "sent">("draft");

  const [sid, setSid] = useState(0);
  const [from, setFrom] = useState(dstr(mondayOf(new Date())));
  const [to, setTo] = useState(dstr(new Date()));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<FeedbackRow | null>(null);
  const [editText, setEditText] = useState("");
  const [delId, setDelId] = useState(0);
  const [hasDraft, setHasDraft] = useState(false);
  const [useAi, setUseAi] = useState(false);
  const [aiReady, setAiReady] = useState(false);
  const [aiModel, setAiModel] = useState("");

  useEffect(() => {
    api<{ enabled: boolean; model: string }>("/api/ai")
      .then((r) => {
        setAiReady(r.enabled);
        setAiModel(r.model);
        setUseAi(r.enabled);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    api<StudentLite[]>("/api/students")
      .then((r) => setStudents(r.filter((s) => s.status === "active")))
      .catch(() => {});
    const sp = new URLSearchParams(window.location.search);
    const s = sp.get("student");
    if (s) setSid(Number(s));
  }, []);

  const load = useCallback(() => {
    api<FeedbackRow[]>("/api/feedback")
      .then((r) => {
        setRows(r);
        setHasDraft(r.some((f) => f.status === "draft"));
      })
      .catch((e: Error) => toast.bad(e.message));
  }, [toast]);

  useEffect(load, [load]);

  const filtered = useMemo(() => (rows ?? []).filter((f) => f.status === tab), [rows, tab]);

  function quickRange(kind: "week" | "lastweek" | "month" | "lastmonth") {
    const now = new Date();
    if (kind === "week") {
      setFrom(dstr(mondayOf(now)));
      setTo(dstr(now));
    } else if (kind === "lastweek") {
      const mon = mondayOf(now);
      mon.setDate(mon.getDate() - 7);
      const sun = new Date(mon);
      sun.setDate(sun.getDate() + 6);
      setFrom(dstr(mon));
      setTo(dstr(sun));
    } else if (kind === "month") {
      setFrom(dstr(new Date(now.getFullYear(), now.getMonth(), 1)));
      setTo(dstr(now));
    } else {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const t = new Date(now.getFullYear(), now.getMonth(), 0);
      setFrom(dstr(f));
      setTo(dstr(t));
    }
  }

  async function generate() {
    if (!sid) {
      toast.bad("先选学生");
      return;
    }
    setBusy(true);
    try {
      const res = await post<{ content: string; ai?: { used: boolean; model?: string; reason?: string } }>(
        "/api/feedback/generate",
        { studentId: sid, from, to, useAi },
      );
      setText(res.content);
      if (res.ai?.used) {
        toast.ok(`AI（${res.ai.model}）润色好了，读一遍改成自己的语气再发`);
      } else if (res.ai?.reason) {
        toast.ok(`${res.ai.reason}。读一遍改成自己的语气再发`);
      } else {
        toast.ok("草稿生成好了，读一遍改成自己的语气再发");
      }
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function batchGenerate() {
    setBusy(true);
    try {
      const r = await post<{ created: number; skipped: number; createdNames: string[] }>(
        "/api/feedback/batch",
        { from, to },
      );
      if (r.created === 0 && r.skipped > 0) {
        toast.ok("这段时间有课的学生都已经有草稿了");
      } else if (r.created === 0) {
        toast.bad("这段时间还没有课，先排课再生成");
      } else {
        toast.ok(`已生成 ${r.created} 份草稿${r.skipped ? `，${r.skipped} 人已有草稿跳过` : ""}`);
      }
      load();
      setTab("draft");
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(markSent: boolean) {
    if (!sid) {
      toast.bad("先选学生");
      return;
    }
    if (!text.trim()) {
      toast.bad("还没有内容");
      return;
    }
    setBusy(true);
    try {
      const r = await post<{ id: number }>("/api/feedback", { studentId: sid, periodStart: from, periodEnd: to, content: text });
      if (markSent) await patch(`/api/feedback/${r.id}`, { status: "sent" });
      toast.ok(markSent ? "已保存并标记发送" : "已保存草稿");
      setText("");
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(text0: string) {
    try {
      await navigator.clipboard.writeText(text0);
      toast.ok("已复制，去微信粘贴给家长吧");
    } catch {
      toast.bad("复制失败，手动全选复制一下");
    }
  }

  async function markSent(f: FeedbackRow) {
    await patch(`/api/feedback/${f.id}`, { status: "sent" }).catch((e: Error) => toast.bad(e.message));
    toast.ok("已标记为发送");
    load();
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    try {
      await patch(`/api/feedback/${editing.id}`, { content: editText });
      toast.ok("已保存");
      setEditing(null);
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    try {
      await del(`/api/feedback/${delId}`);
      toast.ok("已删除");
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setDelId(0);
    }
  }

  const current = students.find((s) => s.id === sid);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">家长反馈</h1>
          <p className="page-sub">把这段时间记的学情，组织成一段能直接发给家长的话。生成的是草稿，发之前一定自己读一遍。</p>
        </div>
        <div className="page-head-actions">
          <Btn icon="users" loading={busy} onClick={batchGenerate}>
            有课的一起生成
          </Btn>
          <Btn
            icon="sparkles"
            variant="primary"
            loading={busy}
            onClick={generate}
            disabled={!sid}
          >
            生成草稿
          </Btn>
        </div>
      </div>

      <Card>
        <CardHead title="生成一份反馈" icon="sparkles" sub="按时间取学情、出勤和课时，自动组织成家长能看懂的话" />
        <div className="card-body">
          <div className="form-grid">
            <Field label="学生" required>
              <select className="select" value={sid} onChange={(e) => setSid(Number(e.target.value))}>
                <option value={0}>选择学生…</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.grade ? `（${s.grade}）` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="周期" required>
              <div className="row" style={{ gap: 6 }}>
                <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                <span className="muted">至</span>
                <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
              <div className="chip-list" style={{ marginTop: 8 }}>
                <button className="chip" onClick={() => quickRange("week")}>本周</button>
                <button className="chip" onClick={() => quickRange("lastweek")}>上周</button>
                <button className="chip" onClick={() => quickRange("month")}>本月</button>
                <button className="chip" onClick={() => quickRange("lastmonth")}>上月</button>
              </div>
            </Field>
          </div>

          <div className="row between wrap" style={{ gap: 10, marginTop: 14 }}>
            <Switch
              on={aiReady && useAi}
              onChange={(v) => {
                if (!aiReady) {
                  toast.bad("先在「设置」里打开 AI 润色并填好接口");
                  return;
                }
                setUseAi(v);
              }}
              label={aiReady ? `用 AI（${aiModel}）润色一遍` : "用 AI 润色（设置里还没开）"}
            />
            <span className="fs-xs muted">AI 只改表达，事实和数字全部来自你的记录</span>
          </div>

          {text && (
            <div className="mt-3">
              <Field label={`草稿（${current ? current.name : ""} ${from} ~ ${to}）`} hint="改完再保存，语气更自然">
                <textarea className="textarea mono" rows={14} value={text} onChange={(e) => setText(e.target.value)} style={{ lineHeight: 1.7 }} />
              </Field>
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                <Btn variant="primary" icon="copy" onClick={() => copy(text)}>
                  复制全文
                </Btn>
                <Btn icon="save" loading={busy} onClick={() => saveDraft(false)}>
                  存草稿
                </Btn>
                <Btn icon="send" loading={busy} onClick={() => saveDraft(true)}>
                  已发给家长
                </Btn>
                <Btn icon="printer" onClick={() => window.print()}>
                  打印 / 存 PDF
                </Btn>
                <div className="spacer" />
                <Btn variant="ghost" onClick={() => setText("")}>
                  清空
                </Btn>
              </div>
            </div>
          )}

          {!text && !sid && (
            <div className="info-box mt-3">
              <Icon name="info" size={15} />
              先选学生和周期，点「生成草稿」。写反馈的原料是每天下课后记的学情——记得越细，反馈越好写。
            </div>
          )}
        </div>
      </Card>

      <Section
        title={tab === "draft" ? "草稿箱" : "已发送"}
        count={filtered.length}
        mt
      >
        <Tabs
          items={[
            { key: "draft", label: "草稿", count: (rows ?? []).filter((f) => f.status === "draft").length },
            { key: "sent", label: "已发送", count: (rows ?? []).filter((f) => f.status === "sent").length },
          ]}
          value={tab}
          onChange={(k) => setTab(k as "draft" | "sent")}
        />

        {filtered.length === 0 ? (
          <Card>
            <Empty
              icon="message"
              title={tab === "draft" ? "还没有草稿" : "还没发过反馈"}
              text={tab === "draft" ? "上面选学生、选周期，点生成就有一份" : "发送后把草稿标记为「已发给家长」，这里就有了"}
            />
          </Card>
        ) : (
          <div className="col">
            {filtered.map((f) => (
              <Card key={f.id}>
                <div className="row" style={{ gap: 10, padding: "12px 14px" }}>
                  <Avatar name={f.student_name} size="sm" />
                  <div className="grow">
                    <div className="row-title">
                      {f.student_name}
                      <span className="muted fs-sm" style={{ marginLeft: 8 }}>
                        {f.period_start} ~ {f.period_end}
                      </span>
                    </div>
                    <div className="row-sub ellipsis">{f.content.split("\n").find(Boolean) ?? ""}</div>
                  </div>
                  <div className="row-side row" style={{ gap: 6 }}>
                    <Badge tone={f.status === "sent" ? "sent" : "draft"}>
                      {f.status === "sent" ? `已发 ${f.sent_at ? relTime(f.sent_at) : ""}` : "草稿"}
                    </Badge>
                    <Btn size="sm" variant="ghost" icon="copy" onClick={() => copy(f.content)}>
                      复制
                    </Btn>
                    {f.status === "draft" && (
                      <Btn size="sm" variant="ghost" icon="send" onClick={() => markSent(f)}>
                        已发
                      </Btn>
                    )}
                    <Btn
                      size="sm"
                      variant="ghost"
                      icon="edit"
                      onClick={() => {
                        setEditing(f);
                        setEditText(f.content);
                      }}
                    >
                      编辑
                    </Btn>
                    <Btn size="sm" variant="ghost" icon="trash" onClick={() => setDelId(f.id)} />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `编辑反馈：${editing.student_name}` : ""}
        wide
        footer={
          <>
            <Btn onClick={() => setEditing(null)}>取消</Btn>
            <Btn variant="primary" loading={busy} onClick={saveEdit}>
              保存
            </Btn>
          </>
        }
      >
        <textarea className="textarea mono" rows={14} value={editText} onChange={(e) => setEditText(e.target.value)} style={{ lineHeight: 1.7 }} />
      </Modal>

      <Confirm
        open={!!delId}
        title="删除这条反馈？"
        text="删除后无法恢复，学情记录不受影响。"
        confirmText="删除"
        danger
        onConfirm={doDelete}
        onClose={() => setDelId(0)}
      />
    </>
  );
}
