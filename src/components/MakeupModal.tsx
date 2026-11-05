"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { today } from "@/lib/format";
import { Btn, Field, Modal, useToast } from "./ui";

interface Course {
  id: number;
  name: string;
  default_minutes: number;
}

export interface MakeupTarget {
  id: number;
  name: string;
  courseId?: number;
}

/** 一键补课：选个时间就能生成一节 status='makeup' 的课，直接跳去记一笔 */
export function MakeupModal({
  target,
  onClose,
  onCreated,
}: {
  target: MakeupTarget | null;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState(0);
  const [date, setDate] = useState(today());
  const [time, setTime] = useState("16:30");
  const [minutes, setMinutes] = useState(90);
  const [room, setRoom] = useState("");
  const [busy, setBusy] = useState(false);
  const open = !!target;

  useEffect(() => {
    if (!open) return;
    setDate(today());
    setRoom("");
    api<Course[]>("/api/courses")
      .then((cs) => {
        setCourses(cs);
        if (cs.length === 0) return;
        const prefer = target?.courseId ? cs.find((c) => c.id === target.courseId) : null;
        const pick = prefer || cs[0];
        setCourseId(pick.id);
        setMinutes(pick.default_minutes || 90);
      })
      .catch(() => setCourses([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.id]);

  async function submit(force = false) {
    if (!target) return;
    if (!courseId) {
      toast.bad("先建一门课程");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          startAt: `${date} ${time}`,
          minutes,
          room: room || undefined,
          studentIds: [target.id],
          title: "补课",
          status: "makeup",
          force,
        }),
      });
      const body = await res.json();
      if (res.status === 409) {
        setBusy(false);
        if (window.confirm(`${body.error}\n仍然排这节课吗？`)) await submit(true);
        return;
      }
      if (!res.ok) throw new Error(body.error || "排课失败");
      toast.ok(`已给${target.name}排上补课`);
      onCreated?.();
      onClose();
      router.push(`/lessons/${body.id}`);
    } catch (e) {
      toast.bad(e instanceof Error ? e.message : "排课失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={target ? `给${target.name}排补课` : "排补课"}
      footer={
        <>
          <Btn onClick={onClose}>取消</Btn>
          <Btn variant="primary" loading={busy} onClick={() => submit()}>
            排上课
          </Btn>
        </>
      }
    >
      <div className="form-grid">
        <Field label="日期" required>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="时间" required>
          <input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="课程" required>
          <select
            className="select"
            value={courseId}
            onChange={(e) => {
              const id = Number(e.target.value);
              setCourseId(id);
              const c = courses.find((x) => x.id === id);
              if (c?.default_minutes) setMinutes(c.default_minutes);
            }}
          >
            {courses.length === 0 && <option value={0}>还没有课程</option>}
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="时长（分钟）">
          <input
            className="input"
            type="number"
            min={15}
            max={300}
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </Field>
        <Field label="教室 / 备注">
          <input className="input" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="可不填" />
        </Field>
      </div>
      <p className="field-hint" style={{ marginTop: 10 }}>
        会生成一节「补课」状态的课，排好直接进记一笔页面；学生这节不扣课时可以改成请假。
      </p>
    </Modal>
  );
}
