"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ATT_CN, durationText, LESSON_STATUS_CN, timeOf } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { Badge, Card, CardHead, Empty, Skeleton } from "@/components/ui";

type ShareData = {
  student: { name: string; grade: string; school: string };
  balanceMinutes: number;
  next: { start_at: string; course_name: string; title: string } | null;
  lessons: Array<{
    id: number;
    start_at: string;
    minutes: number;
    status: string;
    course_name: string;
    title: string;
    att_status: string;
  }>;
  notes: Array<{ id: number; created_at: string; topic: string; level: number; content: string }>;
  month: {
    label: string;
    lessons: number;
    attended: number;
    leave: number;
    absent: number;
    billedMinutes: number;
  };
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

// 家长看的徽标：来了就「出勤」，请假/缺席照实说，过去的课还没记就写「待记一笔」
function badgeOf(l: ShareData["lessons"][number]): { tone: "ok" | "warn" | "brand" | "default"; text: string } {
  const att = ATT_CN[l.att_status ?? ""];
  if (l.att_status === "present") return { tone: "ok", text: att };
  if (l.att_status === "makeup") return { tone: "ok", text: att ?? "补课" };
  if (l.att_status === "leave" || l.att_status === "absent") return { tone: "warn", text: att };
  const past = new Date(l.start_at.replace(" ", "T")) < new Date();
  if (l.status === "planned" && past) return { tone: "warn", text: "待记一笔" };
  if (l.status === "cancelled") return { tone: "default", text: LESSON_STATUS_CN[l.status] ?? "停课" };
  return { tone: "brand", text: LESSON_STATUS_CN[l.status] ?? l.status };
}

export default function SharePage() {
  const p = useParams<{ id: string | string[] }>();
  const [data, setData] = useState<ShareData | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const id = Array.isArray(p.id) ? p.id[0] : (p.id ?? "");
    const k = new URLSearchParams(window.location.search).get("k") ?? "";
    api<ShareData>(`/api/share?id=${id}&k=${k}`)
      .then((d) => setData(d))
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [p.id]);

  if (loading) {
    return (
      <div className="share-card">
        <Skeleton h={90} />
        <Skeleton h={200} />
        <Skeleton h={160} />
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="share-card share-err">
        <div className="share-err-icon">🔒</div>
        <h2>链接打不开</h2>
        <p>{err || "链接不对或已经失效"}</p>
        <p className="share-err-hint">请联系老师重新发一份，链接有过期时间</p>
      </div>
    );
  }

  const hours = data.balanceMinutes / 60;

  return (
    <div className="share-card">
      <div className="share-head">
        <div className="share-avatar">{data.student.name.slice(0, 1)}</div>
        <div className="share-head-text">
          <div className="share-name">{data.student.name}</div>
          <div className="share-sub">
            {data.student.school}
            {data.student.grade ? ` · ${data.student.grade}` : ""}
          </div>
        </div>
        <div className="share-balance">
          <b>{hours.toFixed(1)}</b>
          <span>剩余课时</span>
        </div>
      </div>

      {data.next ? (
        <div className="share-next">
          <span className="share-next-label">下次上课</span>
          <b>
            {dayLabel(data.next.start_at)} {timeOf(data.next.start_at)}
          </b>
          <span>
            {data.next.course_name}
            {data.next.title ? ` · ${data.next.title}` : ""}
          </span>
        </div>
      ) : null}

      {data.month.lessons > 0 ? (
        <div className="share-month">
          <div className="share-month-head">
            <span className="share-month-label">{data.month.label}小结</span>
            {(data.month.leave > 0 || data.month.absent > 0) && (
              <span className="share-month-extra">
                {[
                  data.month.leave > 0 ? `请假 ${data.month.leave} 次` : "",
                  data.month.absent > 0 ? `缺勤 ${data.month.absent} 次` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </div>
          <div className="share-month-nums">
            <div>
              <b>{data.month.lessons}</b>
              <span>节安排</span>
            </div>
            <div>
              <b>{data.month.attended}</b>
              <span>节到课</span>
            </div>
            <div>
              <b>{(data.month.billedMinutes / 60).toFixed(1)}</b>
              <span>小时课时</span>
            </div>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHead title="最近的小结" />
        {data.notes.length === 0 ? (
          <Empty icon="edit" title="还没记过小结" text="老师上完课会在这里写一句" />
        ) : (
          <div className="share-notes">
            {data.notes.map((n) => (
              <div key={n.id} className="share-note">
                <div className="share-note-head">
                  <b>{n.topic || "课堂小结"}</b>
                  <span>{dayLabel(n.created_at)}</span>
                </div>
                <div
                  className="share-note-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(n.content || "") }}
                />
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHead title="最近上课" />
        {data.lessons.length === 0 ? (
          <Empty icon="calendar" title="还没上过课" />
        ) : (
          <div className="share-lessons">
            {data.lessons.map((l) => (
              <div key={l.id} className="share-lesson">
                <div className="share-lesson-day">
                  <b>{dayLabel(l.start_at)}</b>
                  <span>
                    {timeOf(l.start_at)} · {durationText(l.minutes)}
                  </span>
                </div>
                <div className="share-lesson-main">
                  <div>
                    {l.course_name}
                    {l.title ? ` · ${l.title}` : ""}
                  </div>
                </div>
                <Badge tone={badgeOf(l).tone}>{badgeOf(l).text}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="share-foot">这个页面只有老师发的链接能打开 · 数据来自老师的记录</div>
    </div>
  );
}
