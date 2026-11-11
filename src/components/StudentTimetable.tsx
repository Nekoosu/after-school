"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Icon } from "@/components/icons";
import { Avatar, Badge, Btn, Card, CardHead, Empty, PageLoading, Tabs, useToast } from "@/components/ui";
import { api } from "@/lib/client";
import { durationText, timeOf, LESSON_STATUS_CN } from "@/lib/format";

/** 学生详情里塞进来的「多科课表」Tab：过去两周 + 未来五周的课，按天排 */
interface TTLesson {
  lesson_id: number;
  start_at: string;
  minutes: number;
  status: string;
  room: string | null;
  title: string | null;
  course_name: string;
  course_color: string | null;
  teacher_name: string | null;
  att_status: string | null;
}

interface TTCourse {
  course_id: number | null;
  course_name: string;
  course_color: string | null;
  balance_minutes: number;
  last_price: number | null;
}

const ATT_CN: Record<string, string> = {
  present: "已到",
  leave: "请假",
  absent: "缺勤",
  makeup: "补课",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function dayKey(s: string): string {
  return s.slice(0, 10);
}
function dayLabel(k: string): string {
  const [y, m, d] = k.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const wd = ["日", "一", "二", "三", "四", "五", "六"][dt.getDay()];
  return `${m}月${d}日 周${wd}`;
}

export function StudentTimetable({ studentId }: { studentId: number }) {
  const toast = useToast();
  const [lessons, setLessons] = useState<TTLesson[] | null>(null);
  const [byCourse, setByCourse] = useState<TTCourse[]>([]);

  useEffect(() => {
    api<{ lessons: TTLesson[]; byCourse: TTCourse[] }>(`/api/students/${studentId}/timetable`)
      .then((r) => {
        setLessons(r.lessons);
        setByCourse(r.byCourse ?? []);
      })
      .catch((e: Error) => toast.bad(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const grouped = useMemo(() => {
    const map = new Map<string, TTLesson[]>();
    for (const l of lessons ?? []) {
      const k = dayKey(l.start_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(l);
    }
    return Array.from(map.entries());
  }, [lessons]);

  const today = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);

  if (lessons === null) return <PageLoading />;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* 每科余额：一科一行，存了几种班型就几行 */}
      {byCourse.length > 0 ? (
        <Card>
          <CardHead title="各科课时余额" icon="wallet" />
          <div className="row wrap" style={{ gap: 10, padding: "0 14px 14px" }}>
            {byCourse.map((c) => (
              <div key={c.course_id ?? c.course_name} className="stat-mini" style={{ borderLeft: `3px solid ${c.course_color ?? "#2563eb"}` }}>
                <div className="strong">{c.course_name}</div>
                <div className="fs-sm muted">
                  剩 {durationText(c.balance_minutes)}
                  {c.last_price ? ` · ${c.last_price} 元/小时` : ""}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {grouped.length === 0 ? (
        <Empty icon="calendar" title="这三周没有课" text="去「课表」页给学生排课，或者看看更远的日期。" />
      ) : (
        grouped.map(([k, items]) => (
          <Card key={k}>
            <div className="row between" style={{ padding: "10px 14px 0" }}>
              <b className={k === today ? "" : "muted"}>
                {dayLabel(k)}
                {k === today ? <Badge tone="ok">今天</Badge> : null}
              </b>
              <span className="fs-xs muted">{items.length} 节</span>
            </div>
            <div style={{ padding: "8px 14px 14px", display: "grid", gap: 8 }}>
              {items.map((l) => (
                <a key={l.lesson_id} href={`/lessons/${l.lesson_id}`} className="tt-row" style={{ borderLeft: `3px solid ${l.course_color ?? "#2563eb"}` }}>
                  <span className="t">{timeOf(l.start_at)}</span>
                  <span className="grow">
                    <b>{l.course_name}</b>
                    {l.title ? <span className="muted fs-sm">　{l.title}</span> : null}
                    <span className="fs-sm muted" style={{ display: "block" }}>
                      {l.teacher_name ? `${l.teacher_name} · ` : ""}
                      {durationText(l.minutes)}
                      {l.room ? ` · ${l.room}` : ""}
                    </span>
                  </span>
                  {l.status === "done" ? (
                    <Badge tone={l.att_status === "leave" || l.att_status === "absent" ? "warn" : "ok"}>
                      {ATT_CN[l.att_status ?? ""] ?? "已上"}
                    </Badge>
                  ) : (
                    <Badge>{LESSON_STATUS_CN[l.status] ?? l.status}</Badge>
                  )}
                </a>
              ))}
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

/** 只在学生详情页里挂的独立组件（页面本体保持不动，用 tab 挂进来） */
export default function StudentTimetableTab() {
  const params = useParams<{ id: string }>();
  const sid = Number(params?.id);
  if (!sid) return <Empty icon="alert" title="缺学生 id" />;
  return <StudentTimetable studentId={sid} />;
}
