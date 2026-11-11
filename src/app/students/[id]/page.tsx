"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { MakeupModal } from "@/components/MakeupModal";
import { MicButton } from "@/components/MicButton";
import { StudentTimetable } from "@/components/StudentTimetable";
import {
  Avatar,
  Badge,
  Btn,
  Card,
  CardHead,
  Confirm,
  Empty,
  Field,
  InfoGrid,
  Menu,
  MenuItem,
  MenuSep,
  Modal,
  PageLoading,
  Progress,
  Stat,
  Tabs,
  useToast,
} from "@/components/ui";
import { api, copyText, del, patch, post } from "@/lib/client";
import { useAutoNew } from "@/lib/autoNew";
import {
  ATT_CN,
  LEDGER_KIND_CN,
  LEVEL_CN,
  LESSON_STATUS_CN,
  NOTE_KIND_CN,
  PAY_METHOD_CN,
  relTime,
  timeOf,
  toHours,
} from "@/lib/format";

interface Student {
  id: number;
  name: string;
  gender: string | null;
  grade: string | null;
  school: string | null;
  guardian_name: string | null;
  guardian_phone: string | null;
  guardian_wechat: string | null;
  note: string | null;
  tags: string | null;
  status: string;
  joined_at: string | null;
}

interface Ledger {
  id: number;
  delta_minutes: number;
  kind: string;
  remark: string | null;
  created_at: string;
}

interface Note {
  id: number;
  kind: string;
  topic: string | null;
  level: number | null;
  content: string;
  created_at: string;
}

interface LessonRec {
  lesson_id: number;
  start_at: string;
  course_name: string;
  status: string;
  att_status: string | null;
  billed_minutes: number | null;
}

interface Payment {
  id: number;
  amount: number;
  minutes: number | null;
  method: string | null;
  paid_at: string;
  remark: string | null;
}

interface Detail {
  student: Student;
  balance_minutes: number;
  balance_hours: number;
  ledger: Ledger[];
  notes: Note[];
  lessons: LessonRec[];
  payments: Payment[];
  paidTotal: number;
  topics: TopicStat[];
}

interface TopicStat {
  topic: string;
  count: number;
  avg_level: number | null;
  last_level: number | null;
  last_at: string;
  recent_levels: string | null;
}

type TabKey = "overview" | "notes" | "topics" | "timetable" | "hours" | "lessons" | "payments";

const KIND_OPTS = [
  { key: "progress", label: "学习进展" },
  { key: "homework", label: "作业情况" },
  { key: "behavior", label: "课堂表现" },
  { key: "parent", label: "家长沟通" },
];

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const sid = Number(id);
  const router = useRouter();
  const toast = useToast();

  const [data, setData] = useState<Detail | null>(null);
  const [tab, setTab] = useState<TabKey>(() => {
    // 支持 /students/5?tab=topics 这种直链，方便从别处跳过来
    if (typeof window === "undefined") return "overview";
    const t = new URLSearchParams(window.location.search).get("tab");
    const okTabs: TabKey[] = ["overview", "notes", "topics", "timetable", "hours", "lessons", "payments"];
    return okTabs.includes(t as TabKey) ? (t as TabKey) : "overview";
  });
  const [err, setErr] = useState("");
  const [threshold, setThreshold] = useState(450);

  // 弹窗
  const [noteOpen, setNoteOpen] = useState(false);
  useAutoNew(setNoteOpen); // 顶栏「记一笔」跳 ?new=1，直接把记学情弹层打开
  const [payOpen, setPayOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [makeupOpen, setMakeupOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [noteForm, setNoteForm] = useState({ kind: "progress", topic: "", level: 3, content: "" });
  const [payForm, setPayForm] = useState({
    amount: "",
    minutes: "540",
    method: "wechat",
    paidAt: new Date().toISOString().slice(0, 10),
    remark: "",
  });
  const [adjForm, setAdjForm] = useState({ deltaMinutes: "", kind: "gift", remark: "" });
  const [editForm, setEditForm] = useState({
    name: "",
    grade: "",
    gender: "",
    school: "",
    guardianName: "",
    guardianPhone: "",
    guardianWechat: "",
    note: "",
  });

  const load = useCallback(() => {
    api<Detail>(`/api/students/${sid}`)
      .then((d) => {
        setData(d);
        setEditForm({
          name: d.student.name,
          grade: d.student.grade ?? "",
          gender: d.student.gender ?? "",
          school: d.student.school ?? "",
          guardianName: d.student.guardian_name ?? "",
          guardianPhone: d.student.guardian_phone ?? "",
          guardianWechat: d.student.guardian_wechat ?? "",
          note: d.student.note ?? "",
        });
      })
      .catch((e: Error) => setErr(e.message));
  }, [sid]);

  useEffect(() => {
    load();
    api<Record<string, string>>("/api/settings")
      .then((s) => setThreshold(Number(s.low_balance_minutes || 450)))
      .catch(() => {});
  }, [load]);

  if (err) return <div className="error-box">加载失败：{err}</div>;
  if (!data) return <PageLoading />;

  const s = data.student;
  const bal = data.balance_minutes;
  const low = bal < threshold;
  const lessonCount = data.lessons.filter((l) => l.status === "done").length;

  async function saveNote() {
    if (!noteForm.content.trim()) {
      toast.bad("写一句再保存");
      return;
    }
    setBusy(true);
    try {
      await post(`/api/students/${sid}/notes`, noteForm);
      toast.ok("已记下");
      setNoteOpen(false);
      setNoteForm({ kind: "progress", topic: "", level: 3, content: "" });
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function savePay() {
    const amount = Number(payForm.amount);
    const minutes = Number(payForm.minutes || 0);
    if (!(amount > 0)) {
      toast.bad("金额要大于 0");
      return;
    }
    setBusy(true);
    try {
      await post("/api/payments", { ...payForm, amount, minutes, studentId: sid });
      toast.ok("已记录收款并充值课时");
      setPayOpen(false);
      setPayForm({ ...payForm, amount: "", remark: "" });
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveAdj() {
    const d = Number(adjForm.deltaMinutes);
    if (!d) {
      toast.bad("填一个非 0 的分钟数");
      return;
    }
    setBusy(true);
    try {
      await post("/api/hours", { ...adjForm, deltaMinutes: d, studentId: sid });
      toast.ok("课时已调整");
      setAdjOpen(false);
      setAdjForm({ deltaMinutes: "", kind: "gift", remark: "" });
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    setBusy(true);
    try {
      await patch(`/api/students/${sid}`, editForm);
      toast.ok("档案已更新");
      setEditOpen(false);
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    setBusy(true);
    try {
      await del(`/api/students/${sid}`);
      toast.ok("已标记为离开");
      router.push("/students");
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="row" style={{ gap: 14, alignItems: "center" }}>
          <Avatar name={s.name} size="lg" />
          <div>
            <h1 className="page-title row" style={{ gap: 8 }}>
              {s.name}
              {s.status === "left" ? <Badge tone="left">已离开</Badge> : null}
              {s.status === "active" && low ? <Badge tone="warn">课时偏少</Badge> : null}
            </h1>
            <p className="page-sub">
              {[s.grade, s.gender, s.school].filter(Boolean).join(" · ") || "档案还没填完整"}
            </p>
          </div>
        </div>
        <div className="page-head-actions">
          <Btn
            icon="send"
            title="复制一个家长能打开的只读链接，微信里粘贴发送"
            onClick={async () => {
              try {
                const r = await api<{ path: string }>(`/api/share/link?id=${sid}`);
                await copyText(`${window.location.origin}${r.path}`);
                toast.ok("链接已复制，发给家长就能看小结和课时");
              } catch (e) {
                toast.bad((e as Error).message);
              }
            }}
          >
            发给家长
          </Btn>
          <Menu
            trigger={
              <Btn icon="more" title="打印学情单、改档案、收学费">
                更多
              </Btn>
            }
          >
            {(close) => (
              <>
                <MenuItem
                  icon="printer"
                  onClick={() => {
                    close();
                    window.print();
                  }}
                >
                  打印学情单
                </MenuItem>
                <MenuItem
                  icon="edit"
                  onClick={() => {
                    close();
                    setEditOpen(true);
                  }}
                >
                  编辑档案
                </MenuItem>
                <MenuItem
                  icon="wallet"
                  onClick={() => {
                    close();
                    setPayOpen(true);
                  }}
                >
                  收学费
                </MenuItem>
                <MenuSep />
                <MenuItem
                  icon="calendar"
                  onClick={() => {
                    close();
                    router.push(`/calendar?student=${sid}`);
                  }}
                >
                  看他的课表
                </MenuItem>
              </>
            )}
          </Menu>
          <Btn variant="primary" icon="edit" onClick={() => setNoteOpen(true)}>
            记一笔学情
          </Btn>
        </div>
      </div>

      <div className="print-head">
        <h1>{s.name} · 学情记录</h1>
        <p>
          {[s.grade, s.gender, s.school].filter(Boolean).join(" · ")}
          {"　"}剩余 {toHours(bal)} 小时　已上 {lessonCount} 次课
        </p>
      </div>

      <div className="stat-grid">
        <Stat
          label="剩余课时"
          value={toHours(bal)}
          unit="小时"
          icon="clock"
          tone={bal <= 0 ? "bad" : low ? "warn" : "ok"}
          foot={bal <= 0 ? "已用完" : low ? "该提醒续费了" : "还够用一阵"}
        />
        <Stat label="已上课次" value={lessonCount} unit="次" icon="calendar" />
        <Stat label="学情记录" value={data.notes.length} unit="条" icon="clipboard" />
        <Stat label="累计交费" value={`¥${(data.paidTotal ?? 0).toLocaleString("zh-CN")}`} icon="wallet" />
      </div>

      <Tabs
        items={[
          { key: "overview", label: "概览" },
          { key: "notes", label: "学情", count: data.notes.length },
          { key: "topics", label: "知识点", count: data.topics.length },
          { key: "timetable", label: "课表" },
          { key: "hours", label: "课时", count: data.ledger.length },
          { key: "lessons", label: "上课记录", count: data.lessons.length },
          { key: "payments", label: "交费", count: data.payments.length },
        ]}
        value={tab}
        onChange={(k) => setTab(k as TabKey)}
      />

      {tab === "overview" && (
        <div className="grid g2" style={{ alignItems: "start" }}>
          <Card>
            <CardHead title="档案" icon="user" actions={<Btn size="sm" variant="ghost" icon="edit" onClick={() => setEditOpen(true)}>改</Btn>} />
            <div className="card-body">
              <InfoGrid
                items={[
                  { k: "年级", v: s.grade || "—" },
                  { k: "性别", v: s.gender || "—" },
                  { k: "学校", v: s.school || "—" },
                  { k: "入学时间", v: s.joined_at || "—" },
                  { k: "家长", v: s.guardian_name || "—" },
                  { k: "电话", v: s.guardian_phone || "—" },
                  { k: "微信", v: s.guardian_wechat || "—" },
                  { k: "标签", v: s.tags || "—" },
                ]}
              />
              {s.note ? <div className="info-box mt-3">{s.note}</div> : null}
            </div>
          </Card>

          <div className="col">
            <Card>
              <CardHead title="最近记录" icon="clipboard" actions={<Btn size="sm" variant="ghost" onClick={() => setTab("notes")}>全部</Btn>} />
              <div className="card-body tight">
                {data.notes.length === 0 ? (
                  <Empty icon="edit" title="还没记过" text="下课后花十秒记一句" action={<Btn size="sm" variant="primary" onClick={() => setNoteOpen(true)}>现在记一笔</Btn>} />
                ) : (
                  <div className="timeline">
                    {data.notes.slice(0, 4).map((n) => (
                      <div key={n.id} className={`tl-item ${(n.level ?? 3) <= 2 ? "warn" : "brand"}`}>
                        <div className="tl-meta">
                          <b>{NOTE_KIND_CN[n.kind] ?? n.kind}</b>
                          {n.topic ? <Badge tone="outline">{n.topic}</Badge> : null}
                          <span className="dim">{relTime(n.created_at)}</span>
                        </div>
                        <div className="tl-text">{n.content}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>

            <Card>
              <CardHead title="快捷操作" icon="zap" />
              <div className="card-body">
                <div className="row wrap" style={{ gap: 8 }}>
                  <Btn size="sm" icon="plus" onClick={() => setPayOpen(true)}>充值课时</Btn>
                  <Btn size="sm" icon="edit" onClick={() => setAdjOpen(true)}>调整课时</Btn>
                  <Btn size="sm" icon="calendar" onClick={() => setMakeupOpen(true)}>排课 / 补课</Btn>
                  <Link href={`/feedback?student=${sid}`} className="btn btn-sm">
                    <Icon name="message" size={14} />
                    写家长反馈
                  </Link>
                  <Link href={`/students/${sid}/statement`} className="btn btn-sm">
                    <Icon name="file" size={14} />
                    上课对账单
                  </Link>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === "notes" && (
        <Card>
          <CardHead
            title="学情记录"
            sub="只追加不修改，期末写反馈全靠它"
            icon="clipboard"
            actions={<Btn size="sm" variant="primary" icon="plus" onClick={() => setNoteOpen(true)}>记一笔</Btn>}
          />
          <div className="card-body">
            {data.notes.length === 0 ? (
              <Empty icon="edit" title="还没有记录" text="第一笔从今天开始" />
            ) : (
              <div className="timeline">
                {data.notes.map((n) => (
                  <div key={n.id} className={`tl-item ${(n.level ?? 3) <= 2 ? "warn" : "brand"}`}>
                    <div className="tl-meta">
                      <b>{NOTE_KIND_CN[n.kind] ?? n.kind}</b>
                      {n.topic ? <Badge tone="outline">{n.topic}</Badge> : null}
                      {n.level ? <Badge tone={(n.level ?? 3) <= 2 ? "warn" : "ok"}>{LEVEL_CN[n.level]}</Badge> : null}
                      <span className="dim">{n.created_at.slice(0, 16)}</span>
                    </div>
                    <div className="tl-text">{n.content}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {tab === "topics" && (
        <Card>
          <CardHead
            title="知识点掌握度"
            sub="把每次「记一笔」里填的知识点和状态汇总起来，不做模型预测"
            icon="target"
            actions={<Btn size="sm" variant="primary" icon="plus" onClick={() => setNoteOpen(true)}>记一笔</Btn>}
          />
          <div className="card-body">
            {data.topics.length === 0 ? (
              <Empty
                icon="target"
                title="还没有知识点数据"
                text="记一笔时在「知识点」里填上这次讲的是什么（比如「两位数进位」），这里就会自动汇总"
              />
            ) : (
              <>
                {data.topics.map((t) => {
                  const levels = (t.recent_levels ?? "")
                    .split(",")
                    .map((x) => Number(x))
                    .filter((x) => x >= 1 && x <= 4);
                  const avg = t.avg_level ?? 0;
                  const tone = avg >= 3.4 ? "ok" : avg <= 2.2 ? "bad" : "warn";
                  return (
                    <div key={t.topic} className="col" style={{ gap: 6, padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
                      <div className="row between">
                        <div className="row" style={{ gap: 8 }}>
                          <b>{t.topic}</b>
                          <span className="muted fs-sm">记过 {t.count} 次</span>
                          {t.last_level ? (
                            <Badge tone={(t.last_level ?? 3) <= 2 ? "warn" : "ok"}>
                              最近 {LEVEL_CN[t.last_level]}
                            </Badge>
                          ) : null}
                        </div>
                        <span className="dim fs-sm">{relTime(t.last_at)}</span>
                      </div>
                      <Progress value={Math.round((avg / 4) * 100)} tone={tone} />
                      <div className="row between fs-xs muted">
                        <span>
                          平均 {(avg || 0).toFixed(1)} 分（1 需加强 ~ 4 优秀）
                          {levels.length > 1 ? ` · 最近 ${levels.map((l) => LEVEL_CN[l]).join(" → ")}` : ""}
                        </span>
                        <span>{levels.length > 1 ? "越靠右越近" : ""}</span>
                      </div>
                    </div>
                  );
                })}
                <div className="info-box mt-2">
                  <Icon name="info" size={15} />
                  这些分数来自你每次记一笔时选的「状态」，系统只做汇总，不替你判断孩子会不会。
                </div>
              </>
            )}
          </div>
        </Card>
      )}

      {tab === "timetable" && <StudentTimetable studentId={sid} />}

      {tab === "hours" && (
        <Card>
          <CardHead
            title="课时流水"
            sub={`余额 = 所有流水相加（当前 ${toHours(bal)} 小时）`}
            icon="clock"
            actions={
              <div className="row" style={{ gap: 6 }}>
                <Btn size="sm" onClick={() => setAdjOpen(true)}>调整</Btn>
                <Btn size="sm" variant="primary" icon="plus" onClick={() => setPayOpen(true)}>充值</Btn>
              </div>
            }
          />
          <div className="table-wrap">
            {data.ledger.length === 0 ? (
              <Empty icon="clock" title="还没有流水" text="收一笔学费或手动调整都会记在这里" />
            ) : (
              <table className="table compact">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>类型</th>
                    <th>变动</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ledger.map((l) => (
                    <tr key={l.id}>
                      <td className="fs-sm muted nowrap">{l.created_at.slice(0, 16)}</td>
                      <td>
                        <Badge tone={l.delta_minutes > 0 ? "ok" : "brand"}>{LEDGER_KIND_CN[l.kind] ?? l.kind}</Badge>
                      </td>
                      <td className={l.delta_minutes > 0 ? "ok strong nowrap" : "danger strong nowrap"}>
                        {l.delta_minutes > 0 ? "+" : ""}
                        {l.delta_minutes} 分钟
                      </td>
                      <td className="fs-sm muted">{l.remark || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      {tab === "lessons" && (
        <Card>
          <CardHead title="上课记录" icon="calendar" />
          <div className="table-wrap">
            {data.lessons.length === 0 ? (
              <Empty icon="calendar" title="还没上过课" text="排一节课，下课记一笔就有记录了" />
            ) : (
              <table className="table compact">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>课程</th>
                    <th>出勤</th>
                    <th>扣课时</th>
                    <th>状态</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.lessons.map((l) => (
                    <tr key={l.lesson_id}>
                      <td className="nowrap fs-sm">
                        {l.start_at.slice(0, 10)} {timeOf(l.start_at)}
                      </td>
                      <td>{l.course_name}</td>
                      <td>
                        {l.att_status ? (
                          <Badge tone={l.att_status === "present" ? "present" : l.att_status === "makeup" ? "makeup" : "leave"}>
                            {ATT_CN[l.att_status] ?? l.att_status}
                          </Badge>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td className="fs-sm">{l.billed_minutes ? `${l.billed_minutes} 分钟` : "—"}</td>
                      <td>
                        <Badge tone={l.status === "done" ? "done" : l.status === "cancelled" ? "cancelled" : "planned"}>
                          {LESSON_STATUS_CN[l.status] ?? l.status}
                        </Badge>
                      </td>
                      <td>
                        <Link href={`/lessons/${l.lesson_id}`} className="btn btn-sm btn-ghost">
                          看
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      {tab === "payments" && (
        <Card>
          <CardHead
            title="交费记录"
            sub={`累计 ¥${(data.paidTotal ?? 0).toLocaleString("zh-CN")}`}
            icon="wallet"
            actions={<Btn size="sm" variant="primary" icon="plus" onClick={() => setPayOpen(true)}>记一笔收款</Btn>}
          />
          <div className="table-wrap">
            {data.payments.length === 0 ? (
              <Empty icon="wallet" title="还没有交费记录" text="收学费时顺手记一下，月底看营收就清楚了" />
            ) : (
              <table className="table compact">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>金额</th>
                    <th>课时</th>
                    <th>方式</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="fs-sm nowrap">{p.paid_at.slice(0, 10)}</td>
                      <td className="strong nowrap">¥{p.amount.toLocaleString("zh-CN")}</td>
                      <td className="fs-sm nowrap">{p.minutes ? `${p.minutes} 分钟` : "—"}</td>
                      <td className="fs-sm">{PAY_METHOD_CN[p.method ?? "other"] ?? "—"}</td>
                      <td className="fs-sm muted">{p.remark || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      )}

      <div className="row between mt-4">
        <span className="muted fs-xs">数据只存在本机，别忘了备份。</span>
        <Btn size="sm" variant="danger" icon="trash" onClick={() => setDelOpen(true)}>
          标记为已离开
        </Btn>
      </div>

      {/* 记学情 */}
      <Modal
        open={noteOpen}
        onClose={() => setNoteOpen(false)}
        title="记一笔学情"
        footer={
          <>
            <Btn onClick={() => setNoteOpen(false)}>取消</Btn>
            <Btn variant="primary" loading={busy} onClick={saveNote}>保存</Btn>
          </>
        }
      >
        <div className="form-grid">
          <Field label="类型">
            <select className="select" value={noteForm.kind} onChange={(e) => setNoteForm({ ...noteForm, kind: e.target.value })}>
              {KIND_OPTS.map((k) => (
                <option key={k.key} value={k.key}>{k.label}</option>
              ))}
            </select>
          </Field>
          <Field label="一句话标签" hint="如 专注、粗心、进步明显">
            <input className="input" value={noteForm.topic} onChange={(e) => setNoteForm({ ...noteForm, topic: e.target.value })} placeholder="可选" />
          </Field>
          <Field label="评价" span2>
            <div className="segmented">
              {[1, 2, 3, 4].map((lv) => (
                <button key={lv} className={noteForm.level === lv ? "on" : ""} onClick={() => setNoteForm({ ...noteForm, level: lv })}>
                  {LEVEL_CN[lv]}
                </button>
              ))}
            </div>
          </Field>
          <Field label="内容" required span2>
            <div className="row" style={{ gap: 6, alignItems: "flex-start" }}>
              <textarea
                className="textarea grow"
                rows={3}
                value={noteForm.content}
                onChange={(e) => setNoteForm({ ...noteForm, content: e.target.value })}
                placeholder="今天上课的状态、做对/做错了什么、下一步注意什么"
                autoFocus
              />
              <MicButton
                base={noteForm.content}
                onText={(t) => setNoteForm((f) => ({ ...f, content: t }))}
              />
            </div>
          </Field>
        </div>
      </Modal>

      {/* 收学费 */}
      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="收学费"
        footer={
          <>
            <Btn onClick={() => setPayOpen(false)}>取消</Btn>
            <Btn variant="primary" loading={busy} onClick={savePay}>保存</Btn>
          </>
        }
      >
        <div className="form-grid">
          <Field label="金额（元）" required>
            <input
              className="input"
              type="number"
              value={payForm.amount}
              onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
              placeholder="如 1200"
              autoFocus
            />
          </Field>
          <Field label="充值课时（分钟）" hint="540 分钟 = 9 小时 = 6 次课">
            <input
              className="input"
              type="number"
              value={payForm.minutes}
              onChange={(e) => setPayForm({ ...payForm, minutes: e.target.value })}
            />
          </Field>
          <Field label="收款方式">
            <select className="select" value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
              {Object.entries(PAY_METHOD_CN).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="日期">
            <input className="input" type="date" value={payForm.paidAt} onChange={(e) => setPayForm({ ...payForm, paidAt: e.target.value })} />
          </Field>
          <Field label="备注" span2>
            <input className="input" value={payForm.remark} onChange={(e) => setPayForm({ ...payForm, remark: e.target.value })} placeholder="如 秋季班 12 次课" />
          </Field>
        </div>
      </Modal>

      {/* 调整课时 */}
      <Modal
        open={adjOpen}
        onClose={() => setAdjOpen(false)}
        title="调整课时"
        footer={
          <>
            <Btn onClick={() => setAdjOpen(false)}>取消</Btn>
            <Btn variant="primary" loading={busy} onClick={saveAdj}>保存</Btn>
          </>
        }
      >
        <div className="form-grid">
          <Field label="分钟数" hint="正数加、负数减。用来纠错、赠送、退费">
            <input
              className="input"
              type="number"
              value={adjForm.deltaMinutes}
              onChange={(e) => setAdjForm({ ...adjForm, deltaMinutes: e.target.value })}
              placeholder="如 90 或 -90"
              autoFocus
            />
          </Field>
          <Field label="类型">
            <select className="select" value={adjForm.kind} onChange={(e) => setAdjForm({ ...adjForm, kind: e.target.value })}>
              <option value="gift">赠送</option>
              <option value="adjust">调整/纠错</option>
              <option value="refund">退费</option>
            </select>
          </Field>
          <Field label="备注" span2>
            <input className="input" value={adjForm.remark} onChange={(e) => setAdjForm({ ...adjForm, remark: e.target.value })} placeholder="写清楚为什么改" />
          </Field>
        </div>
      </Modal>

      {/* 编辑档案 */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="编辑档案"
        wide
        footer={
          <>
            <Btn onClick={() => setEditOpen(false)}>取消</Btn>
            <Btn variant="primary" loading={busy} onClick={saveEdit}>保存</Btn>
          </>
        }
      >
        <div className="form-grid">
          <Field label="姓名" required>
            <input className="input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
          </Field>
          <Field label="年级">
            <input className="input" value={editForm.grade} onChange={(e) => setEditForm({ ...editForm, grade: e.target.value })} />
          </Field>
          <Field label="性别">
            <select className="select" value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })}>
              <option value="">未填</option>
              <option value="男">男</option>
              <option value="女">女</option>
            </select>
          </Field>
          <Field label="学校">
            <input className="input" value={editForm.school} onChange={(e) => setEditForm({ ...editForm, school: e.target.value })} />
          </Field>
          <Field label="家长姓名">
            <input className="input" value={editForm.guardianName} onChange={(e) => setEditForm({ ...editForm, guardianName: e.target.value })} />
          </Field>
          <Field label="家长电话">
            <input className="input" value={editForm.guardianPhone} onChange={(e) => setEditForm({ ...editForm, guardianPhone: e.target.value })} />
          </Field>
          <Field label="家长微信">
            <input className="input" value={editForm.guardianWechat} onChange={(e) => setEditForm({ ...editForm, guardianWechat: e.target.value })} />
          </Field>
          <Field label="备注" span2>
            <textarea className="textarea" rows={2} value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} />
          </Field>
        </div>
      </Modal>

      <Confirm
        open={delOpen}
        title="标记为已离开？"
        text="档案和所有记录都会保留，只是不在列表里显示在读。之后还能改回来。"
        confirmText="确定标记"
        danger
        onConfirm={doDelete}
        onClose={() => setDelOpen(false)}
      />

      <MakeupModal
        target={makeupOpen ? { id: sid, name: data.student.name } : null}
        onClose={() => setMakeupOpen(false)}
        onCreated={load}
      />
    </>
  );
}
