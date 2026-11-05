"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/icons";
import { Badge, Btn, Card, CardHead, Empty, PageLoading, Stat, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import { ATT_CN, LESSON_STATUS_CN, PAY_METHOD_CN, mdText, money, timeOf, toHours } from "@/lib/format";

interface LessonLine {
  id: number;
  start_at: string;
  minutes: number;
  status: string;
  course_name: string;
  title: string | null;
  att_status: string | null;
  billed_minutes: number | null;
}

interface PayLine {
  id: number;
  amount: number;
  minutes: number;
  method: string | null;
  paid_at: string;
  remark: string | null;
}

interface Statement {
  month: string;
  from: string;
  to: string;
  student: { id: number; name: string; grade: string | null; school: string | null; guardian_name: string | null };
  lessons: LessonLine[];
  payments: PayLine[];
  summary: {
    lessonCount: number;
    plannedCount: number;
    billedMinutes: number;
    leaveCount: number;
    absentCount: number;
    makeUpCount: number;
    paidAmount: number;
    paidMinutes: number;
    unitPrice: number;
    balanceMinutes: number;
    billedMoney: number;
  };
}

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function StatementPage() {
  const toast = useToast();
  const params = useParams<{ id: string }>();
  const studentId = Number(params?.id ?? 0);
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<Statement | null>(null);
  const [org, setOrg] = useState<{ org_name: string; teacher_name: string; org_phone: string }>({
    org_name: "",
    teacher_name: "",
    org_phone: "",
  });

  const load = useCallback(() => {
    if (!studentId) return;
    setData(null);
    api<Statement>(`/api/students/${studentId}/statement?month=${month}`)
      .then(setData)
      .catch((e: Error) => toast.bad(e.message));
  }, [studentId, month, toast]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    api<Record<string, string>>("/api/settings")
      .then((s) =>
        setOrg({
          org_name: s.org_name ?? "",
          teacher_name: s.teacher_name ?? "",
          org_phone: s.org_phone ?? "",
        }),
      )
      .catch(() => {});
  }, []);

  const text = useMemo(() => {
    if (!data) return "";
    const s = data.summary;
    const lines: string[] = [];
    lines.push(`${data.student.name} ${Number(data.month.slice(5))} 月上课对账单`);
    lines.push("");
    lines.push(`本月上课 ${s.lessonCount} 次，扣课时 ${toHours(s.billedMinutes)} 小时。`);
    if (s.leaveCount) lines.push(`请假 ${s.leaveCount} 次（不扣课时，可以补）。`);
    if (s.makeUpCount) lines.push(`补课 ${s.makeUpCount} 次。`);
    if (s.absentCount) lines.push(`缺席 ${s.absentCount} 次。`);
    if (s.plannedCount) lines.push(`还有 ${s.plannedCount} 节排着没上。`);
    if (s.paidAmount > 0) {
      lines.push(`本月交费 ${money(s.paidAmount)}，充 ${toHours(s.paidMinutes)} 小时。`);
    } else {
      lines.push("本月没有交费记录。");
    }
    lines.push(`月末剩余课时：${toHours(s.balanceMinutes)} 小时。`);
    lines.push("");
    for (const l of data.lessons) {
      if (l.status !== "done") continue;
      const att = l.att_status ? ATT_CN[l.att_status] ?? l.att_status : "—";
      lines.push(
        `· ${l.start_at.slice(5, 10).replace("-", "/")} ${timeOf(l.start_at)} ${l.course_name}${
          l.title ? "（" + l.title + "）" : ""
        } ${att} ${l.billed_minutes ? "扣 " + toHours(l.billed_minutes) + " 小时" : ""}`.trim(),
      );
    }
    lines.push("");
    lines.push(`${org.org_name || "课后服务中心"}${org.teacher_name ? "  " + org.teacher_name : ""}`);
    return lines.join("\n");
  }, [data, org]);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      toast.ok("对账单文字已复制，可以贴到微信里");
    } catch {
      toast.bad("复制失败，可以手动选中文字");
    }
  }

  if (!studentId) {
    return <Empty icon="users" title="学生编号不对" text="从学生页点一个学生进来。" />;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">上课对账单</h1>
          <p className="page-sub">
            {data ? `${data.student.name}${data.student.grade ? " · " + data.student.grade : ""} · ` : ""}
            一个月上了几次课、扣了多少课时、交了多少费，一页说清
          </p>
        </div>
        <div className="page-head-actions no-print">
          <Link className="btn" href={`/students/${studentId}`}>
            <Icon name="left" size={15} />
            回学生页
          </Link>
          <Btn icon="download" onClick={copyText} disabled={!data}>
            复制文字
          </Btn>
          <Btn variant="primary" icon="printer" onClick={() => window.print()} disabled={!data}>
            打印 / 存 PDF
          </Btn>
        </div>
      </div>

      <div className="cal-toolbar no-print">
        <div className="row" style={{ gap: 8 }}>
          <Btn size="sm" icon="left" onClick={() => setMonth(shiftMonth(month, -1))}>
            上一月
          </Btn>
          <Btn size="sm" onClick={() => setMonth(thisMonth())}>
            本月
          </Btn>
          <Btn size="sm" onClick={() => setMonth(shiftMonth(month, 1))}>
            下一月
            <Icon name="right" size={14} />
          </Btn>
          <span className="cal-range">{data ? `${data.from} 至 ${data.to}` : month}</span>
        </div>
      </div>

      {!data ? (
        <PageLoading text="正在算这个月的账…" />
      ) : (
        <>
          <div className="print-head">
            {org.org_name || "课后服务中心"} · {data.student.name} · {Number(data.month.slice(5))} 月上课对账单
          </div>

          <div className="stat-grid">
            <Stat label="本月上课" value={data.summary.lessonCount} unit="次" icon="check" />
            <Stat
              label="扣课时"
              value={toHours(data.summary.billedMinutes)}
              unit="小时"
              icon="clock"
              tone="violet"
              foot={data.summary.billedMoney ? `约值 ${money(data.summary.billedMoney)}` : undefined}
            />
            <Stat
              label="本月交费"
              value={money(data.summary.paidAmount)}
              icon="wallet"
              tone={data.summary.paidAmount > 0 ? "ok" : undefined}
              foot={data.summary.paidMinutes ? `充 ${toHours(data.summary.paidMinutes)} 小时` : "没交费"}
            />
            <Stat
              label="月末剩余"
              value={toHours(data.summary.balanceMinutes)}
              unit="小时"
              icon="database"
              tone={data.summary.balanceMinutes < 450 ? "warn" : "ok"}
              foot={data.summary.balanceMinutes < 450 ? "该提醒续费了" : "够上"}
            />
          </div>

          <Card>
            <CardHead
              title="上了哪些课"
              sub={`请假 ${data.summary.leaveCount} 次 · 补课 ${data.summary.makeUpCount} 次 · 缺席 ${data.summary.absentCount} 次`}
              icon="calendar"
            />
            {data.lessons.length === 0 ? (
              <div className="card-body">
                <Empty icon="calendar" title="这个月没有排课" text="换个时间范围看看，或者去课表排一节。" />
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>课程</th>
                      <th>出勤</th>
                      <th>课时</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lessons.map((l) => (
                      <tr key={l.id}>
                        <td className="nowrap">
                          {mdText(l.start_at.slice(0, 10))} {timeOf(l.start_at)}
                        </td>
                        <td>
                          <span className="cell-main">
                            {l.course_name}
                            {l.title ? <span className="muted fs-xs">　{l.title}</span> : null}
                          </span>
                        </td>
                        <td>
                          {l.att_status ? (
                            <Badge tone={l.att_status === "present" ? "ok" : l.att_status === "makeup" ? "makeup" : "warn"}>
                              {ATT_CN[l.att_status] ?? l.att_status}
                            </Badge>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                        <td className="nowrap">{l.billed_minutes ? `${toHours(l.billed_minutes)} 小时` : "—"}</td>
                        <td>
                          <Badge tone={l.status === "done" ? "done" : l.status === "makeup" ? "makeup" : "planned"}>
                            {LESSON_STATUS_CN[l.status] ?? l.status}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="交费记录" sub="本月收到的钱" icon="wallet" />
            {data.payments.length === 0 ? (
              <div className="card-body">
                <div className="muted fs-sm">这个月没有交费记录。</div>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="table compact">
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>金额</th>
                      <th>充课时</th>
                      <th>方式</th>
                      <th>备注</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="nowrap">{p.paid_at}</td>
                        <td className="strong">{money(p.amount)}</td>
                        <td>{p.minutes ? `${toHours(p.minutes)} 小时` : "—"}</td>
                        <td>{PAY_METHOD_CN[p.method ?? ""] ?? p.method ?? "—"}</td>
                        <td className="muted">{p.remark ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHead
              title="发给家长的话"
              sub="自动拼好的，可以改完再复制"
              icon="message"
              actions={
                <Btn size="sm" icon="copy" onClick={copyText}>
                  复制
                </Btn>
              }
            />
            <div className="card-body">
              <pre
                className="scroll-y"
                style={{ whiteSpace: "pre-wrap", lineHeight: 1.85, fontSize: 13.5, margin: 0, maxHeight: 420 }}
              >
                {text}
              </pre>
            </div>
          </Card>

          <p className="muted fs-xs no-print">
            单价是按历次交费反推的（金额合计 ÷ 小时合计{data.summary.unitPrice ? ` ≈ ${money(data.summary.unitPrice)}/小时` : ""}
            ），只用来估算「这个月上的课值多少钱」，不是收费依据。
          </p>
        </>
      )}
    </>
  );
}
