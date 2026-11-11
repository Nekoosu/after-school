"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons";
import { MakeupModal, type MakeupTarget } from "@/components/MakeupModal";
import { Sparkline } from "@/components/Sparkline";
import { Avatar, Badge, Card, Empty, PageLoading, Section, Stat } from "@/components/ui";
import { api } from "@/lib/client";
import {
  LESSON_STATUS_CN,
  NOTE_KIND_CN,
  avatarColor,
  mdText,
  money,
  relTime,
  timeOf,
  toHours,
} from "@/lib/format";

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

interface MakeupItem {
  student_id: number;
  student_name: string;
  lesson_id: number;
  start_at: string;
  course_name: string | null;
}

interface LowItem {
  student_id: number;
  name: string;
  balance_minutes: number;
  balance_hours: number;
}

interface NoteItem {
  id: number;
  student_id: number;
  student_name: string;
  kind: string;
  topic: string | null;
  level: number | null;
  content: string;
  created_at: string;
}

interface StaleItem {
  id: number;
  name: string;
  balance_minutes: number;
  last_note_at: string | null;
  last_lesson_at: string | null;
}

interface Dashboard {
  date: string;
  todayLessons: LessonItem[];
  makeupPending: MakeupItem[];
  lowBalanceStudents: LowItem[];
  lowBalanceThreshold: number;
  studentCount: number;
  upcomingLessons: number;
  recentNotes: NoteItem[];
  monthRevenue: number;
  revenueTrend?: Array<{ d: string; amount: number }>;
  monthUsed: number;
  needRecord: Array<{ id: number; start_at: string; course_name: string }>;
  staleStudents: StaleItem[];
  weekLoad?: Array<{
    date: string;
    weekday: number;
    count: number;
    minutes: number;
    done: number;
    isToday: boolean;
  }>;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "还没睡呀";
  if (h < 11) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

function withTeacher(t: string): string {
  if (!t) return "";
  // 设置里很多人直接填「李老师」，别再补一个「老师」变成「李老师老师」
  if (/(老师|先生|女士|阿姨|叔叔)$/.test(t)) return `，${t}`;
  return `，${t}老师`;
}

const WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export default function TodayPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [teacher, setTeacher] = useState("");
  const [err, setErr] = useState("");
  const [makeupTarget, setMakeupTarget] = useState<MakeupTarget | null>(null);

  const load = useCallback(() => {
    api<Dashboard>("/api/dashboard")
      .then(setData)
      .catch((e: Error) => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
    api<Record<string, string>>("/api/settings")
      .then((s) => setTeacher(s.teacher_name ?? ""))
      .catch(() => {});
  }, [load]);

  if (err) return <div className="error-box">加载失败：{err}</div>;
  if (!data) return <PageLoading />;

  const d = new Date(data.date + "T00:00:00");
  const dateLabel = `${d.getMonth() + 1} 月 ${d.getDate()} 日 · ${WEEK_CN[d.getDay()]}`;

  const pendingRecord = data.needRecord ?? [];
  const makeup = data.makeupPending ?? [];
  const low = data.lowBalanceStudents ?? [];
  const notes = data.recentNotes ?? [];
  const stale = data.staleStudents ?? [];

  const wl = data.weekLoad ?? [];
  const wlMax = Math.max(1, ...wl.map((w) => w.count));
  const wlCount = wl.reduce((n, w) => n + w.count, 0);
  const wlHours = toHours(wl.reduce((n, w) => n + w.minutes, 0));
  const firstToday = data.todayLessons[0];

  return (
    <>
      <div className="hero">
        <div className="hero-main">
          <p className="hero-kicker">{dateLabel}</p>
          <h1 className="hero-title">
            {greeting()}
            {withTeacher(teacher)}
          </h1>
          <p className="hero-sub">
            今天 {data.todayLessons.length} 节课
            {firstToday
              ? `　·　第一节 ${timeOf(firstToday.start_at)}　${firstToday.course_name}`
              : "　·　还没排课，给自己留出空当也挺好"}
            {makeup.length > 0 ? `　·　待补课 ${makeup.length} 条` : ""}
          </p>
          <div className="hero-actions">
            <Link href="/calendar?new=1" className="btn btn-primary">
              <Icon name="calendar" size={15} />
              排一节课
            </Link>
            <Link href="/feedback" className="btn">
              <Icon name="message" size={15} />
              写反馈
            </Link>
            <Link href="/students" className="btn">
              <Icon name="users" size={15} />
              学生名册
            </Link>
          </div>
        </div>
        <div className="hero-side">
          <div className="hero-side-head">
            <span>本周负载</span>
            <b>
              {wlCount} 节 / {wlHours} 小时
            </b>
          </div>
          <div className="week-bars">
            {wl.map((w) => (
              <div
                key={w.date}
                className={"wb" + (w.isToday ? " on" : "")}
                title={`${w.date}　${w.count} 节　${toHours(w.minutes)} 小时`}
              >
                <span className="wb-n">{w.count || ""}</span>
                <i style={{ height: Math.max(6, (w.count / wlMax) * 54) }} />
                <em>{WEEK_CN[w.weekday]?.slice(1) ?? ""}</em>
              </div>
            ))}
          </div>
        </div>
      </div>

      {pendingRecord.length > 0 && (
        <div className="warn-box" style={{ marginBottom: 14 }}>
          <Icon name="alert" size={16} />
          <span>
            有 {pendingRecord.length} 节课到点还没记：
            {pendingRecord.map((p) => (
              <Link key={p.id} href={`/lessons/${p.id}`} style={{ marginLeft: 8, fontWeight: 600 }}>
                {p.course_name} {timeOf(p.start_at)}
              </Link>
            ))}
          </span>
        </div>
      )}

      <div className="stat-grid">
        <Stat label="今日课程" value={data.todayLessons.length} unit="节" icon="calendar" />
        <Stat
          label="待补课"
          value={makeup.length}
          unit="条"
          icon="clock"
          tone={makeup.length ? "warn" : undefined}
          foot={makeup.length ? "有孩子请假还没补上" : "都补上了"}
        />
        <Stat label="在读学生" value={data.studentCount} unit="人" icon="users" href="/students" />
        <Stat
          label="本月收款"
          value={money(data.monthRevenue, false)}
          unit="元"
          icon="wallet"
          foot={
            <span className="row between" style={{ width: "100%", gap: 8 }}>
              <span>本月课耗 {toHours(data.monthUsed)} 小时</span>
              <Sparkline data={(data.revenueTrend ?? []).map((r) => r.amount)} />
            </span>
          }
          href="/finance"
        />
      </div>

      <div className="grid g2" style={{ alignItems: "start" }}>
        <Section
          title="今天的课"
          count={data.todayLessons.length}
          actions={
            <Link href="/calendar" className="btn btn-sm btn-ghost">
              看整周
              <Icon name="arrowRight" size={14} />
            </Link>
          }
        >
          <Card>
            {data.todayLessons.length === 0 ? (
              <Empty
                icon="coffee"
                title="今天没有排课"
                text="享受一天清闲，或者现在安排一节课"
                action={
                  <Link href="/calendar?new=1" className="btn btn-sm btn-primary">
                    排一节课
                  </Link>
                }
              />
            ) : (
              <div className="list">
                {data.todayLessons.map((l) => (
                  <Link key={l.id} href={`/lessons/${l.id}`} className="list-row hover">
                    <div className="row-main">
                      <div className="row-title">
                        {timeOf(l.start_at)}　{l.course_name}
                        {l.title ? <span className="dim"> · {l.title}</span> : null}
                      </div>
                      <div className="row-sub">
                        <Icon name="users" size={13} />
                        {l.student_names || "未指定学生"}
                        <span className="dim">　{l.minutes} 分钟</span>
                        {l.room ? <span className="dim">　{l.room}</span> : null}
                      </div>
                    </div>
                    <div className="row-side">
                      <Badge tone={l.status === "done" ? "done" : l.status === "cancelled" ? "cancelled" : "planned"}>
                        {LESSON_STATUS_CN[l.status] ?? l.status}
                      </Badge>
                      <Icon name="right" size={16} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>
        </Section>

        <div className="col">
          <Section
            title="待补课"
            count={makeup.length}
            actions={
              <Link href="/calendar?makeup=1" className="btn btn-sm btn-ghost">
                安排
              </Link>
            }
          >
            <Card>
              {makeup.length === 0 ? (
                <Empty icon="check" title="没有待补的课" text="请假的孩子都补上了" />
              ) : (
                <div className="list">
                  {makeup.slice(0, 6).map((m) => (
                    <div key={`${m.student_id}-${m.lesson_id}`} className="list-row">
                      <Avatar name={m.student_name} size="sm" />
                      <div className="row-main">
                        <div className="row-title">{m.student_name}</div>
                        <div className="row-sub">
                          {mdText(m.start_at.slice(0, 10))} {m.course_name ?? ""} 请假
                        </div>
                      </div>
                      <div className="row-side">
                        <button
                          className="btn btn-sm"
                          onClick={() => setMakeupTarget({ id: m.student_id, name: m.student_name })}
                        >
                          补课
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Section>

          <Section
            title="课时不足"
            count={low.length}
            actions={<span className="section-actions muted">低于 {toHours(data.lowBalanceThreshold)} 小时</span>}
          >
            <Card>
              {low.length === 0 ? (
                <Empty icon="check" title="课时都够用" text="暂时不用催费" />
              ) : (
                <div className="list">
                  {low.slice(0, 6).map((s) => (
                    <Link key={s.student_id} href={`/students/${s.student_id}`} className="list-row hover">
                      <span
                        className="avatar sm"
                        style={{ background: avatarColor(s.name) }}
                        aria-hidden
                      >
                        {s.name.slice(0, 1)}
                      </span>
                      <div className="row-main">
                        <div className="row-title">{s.name}</div>
                        <div className="row-sub">
                          剩 <b className={s.balance_minutes <= 0 ? "danger" : "warn"}>{toHours(s.balance_minutes)}</b> 小时
                        </div>
                      </div>
                      <div className="row-side">
                        <Icon name="right" size={16} />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
          </Section>

          {stale.length > 0 ? (
            <Section
              title="该跟家长说句话了"
              count={stale.length}
              actions={
                <Link href="/feedback" className="btn btn-sm btn-ghost">
                  发反馈
                </Link>
              }
            >
              <Card>
                <div className="list">
                  {stale.slice(0, 4).map((s) => (
                    <Link key={s.id} href={`/students/${s.id}`} className="list-row hover">
                      <Avatar name={s.name} size="sm" />
                      <div className="row-main">
                        <div className="row-title">{s.name}</div>
                        <div className="row-sub">
                          {s.last_note_at ? `上次记录 ${relTime(s.last_note_at)}` : "还没记过"}
                          <span className="dim">　剩 {toHours(s.balance_minutes)} 小时</span>
                        </div>
                      </div>
                      <div className="row-side">
                        <Icon name="right" size={16} />
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            </Section>
          ) : null}
        </div>
      </div>

      <Section
        title="最近记录"
        count={notes.length}
        actions={
          <Link href="/students" className="btn btn-sm btn-ghost">
            去记一笔
            <Icon name="arrowRight" size={14} />
          </Link>
        }
      >
        <Card>
          {notes.length === 0 ? (
            <Empty icon="edit" title="还没有记录" text="下课后花十秒记一句，期末写反馈就轻松了" />
          ) : (
            <div className="timeline">
              {notes.map((n) => (
                <div key={n.id} className={`tl-item ${(n.level ?? 3) <= 2 ? "warn" : "brand"}`}>
                  <div className="tl-meta">
                    <b>{n.student_name}</b>
                    <span>·</span>
                    <span>{NOTE_KIND_CN[n.kind] ?? n.kind}</span>
                    {n.topic ? <Badge tone="outline">{n.topic}</Badge> : null}
                    <span className="dim">{relTime(n.created_at)}</span>
                  </div>
                  <div className="tl-text">{n.content}</div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Section>

      <div className="row between mt-4">
        <span className="muted fs-xs">
          记一笔学情只要十秒，攒起来就是写给家长的话。数据都在你自己电脑里。
        </span>
        <a href="/api/backup" className="btn btn-sm btn-ghost">
          <Icon name="download" size={14} />
          备份数据
        </a>
      </div>

      <MakeupModal target={makeupTarget} onClose={() => setMakeupTarget(null)} onCreated={load} />
    </>
  );
}
