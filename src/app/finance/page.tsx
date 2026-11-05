"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Section,
  Stat,
  useToast,
} from "@/components/ui";
import { api, del, post } from "@/lib/client";
import { money, moneyShort, PAY_METHOD_CN, toHours } from "@/lib/format";
import { useAutoNew } from "@/lib/autoNew";

interface Payment {
  id: number;
  student_id: number;
  student_name: string;
  amount: number;
  minutes: number | null;
  method: string | null;
  paid_at: string;
  remark: string | null;
}

interface PayResp {
  rows: Payment[];
  total: number;
  totalMinutes: number;
  count: number;
}

interface Stats {
  revenue: number;
  revenueCount: number;
  soldMinutes: number;
  usedMinutes: number;
  remainMinutes: number;
  revenueByMonth: { month: string; amount: number; n: number }[];
  revenueByMethod: { method: string; amount: number; n: number }[];
}

interface StudentLite {
  id: number;
  name: string;
  grade: string | null;
  status: string;
  balance_minutes: number | null;
}

const METHODS = ["wechat", "alipay", "cash", "bank", "other"] as const;

function curMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(m: string, delta: number): string {
  const [y, mm] = m.split("-").map(Number);
  const d = new Date(y, mm - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function FinancePage() {
  const toast = useToast();
  const [month, setMonth] = useState(curMonth());
  const [data, setData] = useState<PayResp | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [open, setOpen] = useState(false);
  useAutoNew(setOpen); // 顶栏「记收款」跳 ?new=1，直接把记一笔弹层打开
  const [busy, setBusy] = useState(false);
  const [delId, setDelId] = useState(0);
  const [form, setForm] = useState({
    studentId: 0,
    amount: "",
    minutes: "540",
    method: "wechat",
    paidAt: new Date().toISOString().slice(0, 10),
    remark: "",
  });

  const load = useCallback(() => {
    api<PayResp>(`/api/payments?month=${month}`)
      .then(setData)
      .catch((e: Error) => toast.bad(e.message));
    api<Stats>("/api/stats?months=6")
      .then(setStats)
      .catch(() => {});
  }, [month, toast]);

  useEffect(load, [load]);
  useEffect(() => {
    api<StudentLite[]>("/api/students")
      .then((r) => setStudents(r.filter((s) => s.status === "active")))
      .catch(() => {});
  }, []);

  const maxBar = useMemo(() => Math.max(1, ...(stats?.revenueByMonth ?? []).map((m) => m.amount)), [stats]);

  const monthLabel = useMemo(() => {
    const [y, m] = month.split("-");
    return `${y} 年 ${Number(m)} 月`;
  }, [month]);

  async function submit() {
    if (!form.studentId) {
      toast.bad("先选学生");
      return;
    }
    const amount = Number(form.amount);
    if (!amount || amount <= 0) {
      toast.bad("金额要大于 0");
      return;
    }
    setBusy(true);
    try {
      const r = await post<{ balance_minutes: number; student: string }>("/api/payments", {
        ...form,
        amount,
        minutes: Number(form.minutes) || 0,
      });
      toast.ok(`已记 ${r.student} 收款 ${money(amount)}，余额 ${toHours(r.balance_minutes)} 小时`);
      setOpen(false);
      setForm({ ...form, studentId: 0, amount: "", remark: "" });
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    try {
      await del(`/api/payments?id=${delId}`);
      toast.ok("已撤销，那笔课时也一起扣回来了");
      load();
    } catch (e) {
      toast.bad((e as Error).message);
    } finally {
      setDelId(0);
    }
  }

  if (!data) return <PageLoading />;

  const picked = students.find((s) => s.id === form.studentId);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">收支</h1>
          <p className="page-sub">每收一笔钱记一次，课时自动加上。月底看这里就知道挣了多少。</p>
        </div>
        <div className="page-head-actions">
          <Btn variant="primary" icon="plus" onClick={() => setOpen(true)}>
            记一笔收款
          </Btn>
        </div>
      </div>

      <div className="stat-grid">
        <Stat
          label={`${monthLabel} 收款`}
          value={money(data.total)}
          foot={`${data.count} 笔`}
          icon="wallet"
          tone="ok"
        />
        <Stat
          label="充值课时"
          value={toHours(data.totalMinutes)}
          unit="小时"
          foot="这个月卖出去的"
          icon="clock"
          tone="violet"
        />
        <Stat
          label="近 6 个月收款"
          value={stats ? money(stats.revenue) : "—"}
          foot={stats ? `${stats.revenueCount} 笔` : ""}
          icon="trending"
          tone="violet"
        />
        <Stat
          label="学生未消课时"
          value={stats ? toHours(stats.remainMinutes) : "—"}
          unit="小时"
          foot="全部学生合计"
          icon="layers"
          tone="cyan"
        />
      </div>

      <Section title="近 6 个月收款趋势" mt>
        <Card>
          <div className="card-body">
            {!stats || stats.revenueByMonth.length === 0 ? (
              <Empty icon="chart" title="还没有收款记录" text="记第一笔之后这里就有柱状图了" />
            ) : (
              <div className="bars">
                {stats.revenueByMonth.map((m) => (
                  <div key={m.month} className="bar-col">
                    <div className="bar-value">{m.amount > 0 ? moneyShort(m.amount) : ""}</div>
                    <div className="bar-track">
                      <div
                        className="bar-fill"
                        style={{ height: `${Math.max(3, (m.amount / maxBar) * 100)}%` }}
                        title={`${m.month}：${money(m.amount)}（${m.n} 笔）`}
                      />
                    </div>
                    <div className="bar-label">{Number(m.month.slice(5))} 月</div>
                  </div>
                ))}
              </div>
            )}
            {stats && stats.revenueByMethod.length > 0 && (
              <div className="legend" style={{ marginTop: 14 }}>
                {stats.revenueByMethod.map((m) => (
                  <span key={m.method} className="legend-item">
                    <i className={`legend-dot ${m.method === "wechat" ? "ok" : m.method === "cash" ? "warn" : "brand"}`} />
                    {PAY_METHOD_CN[m.method] ?? m.method} {moneyShort(m.amount)}（{m.n} 笔）
                  </span>
                ))}
              </div>
            )}
          </div>
        </Card>
      </Section>

      <Section title="收款明细" count={data.count} mt>
        <Card>
          <CardHead
            title={monthLabel}
            actions={
              <div className="row" style={{ gap: 6 }}>
                <Btn size="sm" variant="ghost" icon="left" onClick={() => setMonth(shiftMonth(month, -1))} />
                <Btn size="sm" variant="ghost" onClick={() => setMonth(curMonth())}>
                  本月
                </Btn>
                <Btn size="sm" variant="ghost" icon="right" onClick={() => setMonth(shiftMonth(month, 1))} />
              </div>
            }
          />
          {data.rows.length === 0 ? (
            <Empty icon="wallet" title="这个月还没有收款" text="家长交钱后点右上角「记一笔收款」" />
          ) : (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>学生</th>
                    <th style={{ textAlign: "right" }}>金额</th>
                    <th style={{ textAlign: "right" }}>课时</th>
                    <th>方式</th>
                    <th>备注</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((p) => (
                    <tr key={p.id}>
                      <td className="mono nowrap">{p.paid_at}</td>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <Avatar name={p.student_name} size="sm" />
                          <span>{p.student_name}</span>
                        </div>
                      </td>
                      <td style={{ textAlign: "right" }} className="strong">
                        {money(p.amount)}
                      </td>
                      <td style={{ textAlign: "right" }} className="muted">
                        {p.minutes ? `${toHours(p.minutes)} 小时` : "—"}
                      </td>
                      <td>
                        <Badge tone="outline">{PAY_METHOD_CN[p.method ?? "other"] ?? p.method ?? "其他"}</Badge>
                      </td>
                      <td className="muted ellipsis" style={{ maxWidth: 200 }}>
                        {p.remark ?? "—"}
                      </td>
                      <td style={{ width: 40 }}>
                        <button className="btn btn-ghost btn-sm btn-icon" title="撤销这笔收款" onClick={() => setDelId(p.id)}>
                          <Icon name="trash" size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="记一笔收款"
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
          <Field label="学生" required span2>
            <select className="select" value={form.studentId} onChange={(e) => setForm({ ...form, studentId: Number(e.target.value) })}>
              <option value={0}>选择学生…</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.grade ? `（${s.grade}）` : ""} · 余 {toHours(s.balance_minutes ?? 0)} 小时
                </option>
              ))}
            </select>
          </Field>
          <Field label="金额（元）" required>
            <input
              className="input"
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              placeholder="如 1200"
              autoFocus
            />
          </Field>
          <Field label="充值课时（分钟）" hint="540 分钟 = 9 小时">
            <div className="row" style={{ gap: 6 }}>
              <input className="input" type="number" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
              <Btn size="sm" variant="ghost" onClick={() => setForm({ ...form, minutes: "540" })}>
                540
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => setForm({ ...form, minutes: "1080" })}>
                1080
              </Btn>
            </div>
          </Field>
          <Field label="收款方式">
            <select className="select" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAY_METHOD_CN[m]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="收款日期">
            <input className="input" type="date" value={form.paidAt} onChange={(e) => setForm({ ...form, paidAt: e.target.value })} />
          </Field>
          <Field label="备注" span2>
            <input className="input" value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} placeholder="如 秋季班 9 小时" />
          </Field>
        </div>
        {picked && form.minutes && (
          <div className="ok-box mt-2">
            <Icon name="check" size={15} />
            {picked.name} 收款后余额 {toHours((picked.balance_minutes ?? 0) + (Number(form.minutes) || 0))} 小时
          </div>
        )}
      </Modal>

      <Confirm
        open={!!delId}
        title="撤销这笔收款？"
        text="记录会删掉，同时把这笔带来的课时扣回去。已经消费掉的课时不会自动补。"
        confirmText="撤销"
        danger
        onConfirm={doDelete}
        onClose={() => setDelId(0)}
      />
    </>
  );
}
