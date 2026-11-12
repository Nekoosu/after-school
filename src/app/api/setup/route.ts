import { get, setting } from "@/db";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

/** 设置里的默认机构名，等于它就算「还没填」 */
const ORG_DEFAULT = "我的课后服务中心";

function count(sql: string): number {
  return get<{ n: number }>(sql)?.n ?? 0;
}

/**
 * 空账本引导：告诉新用户「先做这四件事」。
 * 只读、空库也能跑；每步都给 done 与 href，前端照着画就行，不用自己算。
 */
export function GET() {
  const courses = count("select count(*) as n from course where status = 'active'");
  const students = count("select count(*) as n from student where status = 'active'");
  const lessons = count("select count(*) as n from lesson");
  const orgName = setting("org_name", "").trim();
  const hasOrg = orgName !== "" && orgName !== ORG_DEFAULT;

  const steps = [
    {
      key: "org",
      label: "填机构名字",
      hint: "反馈和对账单的落款会用到",
      href: "/settings",
      done: hasOrg,
    },
    {
      key: "course",
      label: "建一门课",
      hint: "比如「数学思维 90 分钟」",
      href: "/classes",
      done: courses > 0,
    },
    {
      key: "student",
      label: "加第一个学生",
      hint: "名字加家长电话就够",
      href: "/students?new=1",
      done: students > 0,
    },
    {
      key: "lesson",
      label: "排第一节课",
      hint: "上完会自动提醒你记一笔",
      href: "/calendar?new=1",
      done: lessons > 0,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;

  return ok({
    courses,
    students,
    lessons,
    orgName,
    steps,
    doneCount,
    done: doneCount === steps.length,
    hidden: setting("onboard_hidden", "0") === "1",
  });
}
