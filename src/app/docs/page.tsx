"use client";

import { useEffect, useState } from "react";
import { Section } from "@/components/ui";
import { Icon } from "@/components/icons";

/**
 * /docs —— 开放接口的说明页。
 * 面向「帮我对接的人」：AI 助手作者、想做机器人的自己、Excel 取数。
 * 不堆长篇大论，每条接口一行，例子可以直接抄走。
 */

const ENDPOINTS: Array<{ m: "GET" | "POST"; p: string; d: string }> = [
  { m: "GET", p: "/api/health", d: "探活：服务在不在、数据库正不正常（不用令牌）" },
  { m: "GET", p: "/api/version", d: "版本号（不用令牌）" },
  { m: "GET", p: "/api/v1/summary", d: "几个总数字：学生数、今天课数、本月收款、待补课、余额不足" },
  { m: "GET", p: "/api/v1/students", d: "全部学生 + 课时余额" },
  { m: "POST", p: "/api/v1/students", d: "新建学生 { name, grade?, guardianPhone? … }" },
  { m: "GET", p: "/api/v1/students/:id", d: "一个学生：档案、余额、最近 10 条学情、接下来的课" },
  { m: "GET", p: "/api/v1/lessons", d: "课表，?from=2026-11-01&to=2026-11-30" },
  { m: "GET", p: "/api/v1/notes", d: "学情记录，?studentId=1&limit=20" },
  { m: "POST", p: "/api/v1/notes", d: "追加一条学情 { studentId, content, topic?, level? }" },
];

function Curl({ children }: { children: string }) {
  return (
    <div className="api-code">
      {children}
    </div>
  );
}

export default function DocsPage() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const base = origin || "http://127.0.0.1:3002";

  return (
    <div className="api-docs">
      <Section title="这是给谁用的" mt>
        <p>
          系统把「给别人读数据」的口子留在了 <code>/api/v1/*</code>：AI 助手、QQ/微信机器人、Excel
          插件、家里另一台机器上的小工具，都可以来这里取数或写回一条学情。
          正常使用系统完全不受影响——不开对接，这些口子就是关着的。
        </p>
        <p>
          第一步永远是到 <a href="/settings">设置 → 对接与接口</a> 生成一个令牌。
        </p>
      </Section>

      <Section title="怎么带令牌" mt>
        <p>
          两种方式都行，推荐 Header：
        </p>
        <ul>
          <li>请求头：<code>Authorization: Bearer as_xxxx…</code></li>
          <li>参数：<code>?token=as_xxxx…</code>（写脚本图省事时用）</li>
        </ul>
        <Curl>{`# 看看连通性（不用令牌）
curl ${base}/api/health

# 带令牌取数据
curl -H "Authorization: Bearer as_xxxx…" ${base}/api/v1/summary`}</Curl>
        <p>
          没开令牌时调 /api/v1/* 会得到 403；令牌不对是 401。回复都是 JSON：
          <code>{`{ "ok": true, … }`}</code>，出错时是 <code>{`{ "error": "原因" }`}</code>。
        </p>
      </Section>

      <Section title="接口一览" mt>
        <div className="card">
          <div className="card-body" style={{ padding: "4px 16px" }}>
            {ENDPOINTS.map((e) => (
              <div className="api-endpoint" key={e.p + e.m}>
                <span className={`m${e.m === "POST" ? " post" : ""}`}>{e.m}</span>
                <span className="p">{e.p}</span>
                <span className="d">{e.d}</span>
              </div>
            ))}
          </div>
        </div>
        <p>
          时间段参数 <code>from / to</code> 都是 <code>YYYY-MM-DD</code>；不传就是全部。
          写回的 <code>level</code> 是 1~5 的掌握度，不写就当没打分。
        </p>
      </Section>

      <Section title="直接抄走的例子" mt>
        <p>JavaScript（AI 助手把今天学的东西写回来）：</p>
        <Curl>{`const res = await fetch("${base}/api/v1/notes", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer as_xxxx…",
  },
  body: JSON.stringify({
    studentId: 1,
    topic: "分数应用题",
    level: 3,
    content: "今天过了一遍分数乘法，错题会自己订正了。",
  }),
});
const data = await res.json();`}</Curl>
        <p>Python（每天早上把今天的课发个提醒）：</p>
        <Curl>{`import requests

H = {"Authorization": "Bearer as_xxxx…"}
plan = requests.get("${base}/api/v1/lessons",
                    params={"from": "2026-11-05", "to": "2026-11-05"},
                    headers=H).json()
print(plan["count"], "节课", [l["start_at"] for l in plan["lessons"]])`}</Curl>
        <p>汇总成日报一句话（curl）：</p>
        <Curl>{`curl -s -H "Authorization: Bearer as_xxxx…" ${base}/api/v1/summary`}</Curl>
      </Section>

      <Section title="安全上的几句提醒" mt>
        <ul>
          <li>令牌等于一把钥匙：能读学生名单和联系方式，别贴群、别写进截图。</li>
          <li>怀疑泄露就到设置里「换个新令牌」，旧的一秒失效。</li>
          <li>系统只监听本机，外面的机器访问不到；如果要挂到别的机器，先想清楚再开。</li>
          <li>
            /api/v1 目前以「读」为主，能写的只有学生和学情两处；排课、改课时这类敏感操作故意没开。
          </li>
        </ul>
        <p className="muted fs-xs" style={{ margin: 0 }}>
          <Icon name="info" size={13} /> 接口出问题先看 <code>/api/health</code>：db 不是 ok 就是数据库文件被动了。
        </p>
      </Section>
    </div>
  );
}
