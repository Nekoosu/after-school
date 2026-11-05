/* 新功能冒烟：补课 / 搜索课程记录 / 热力图 / service worker */
const base = process.argv[2] ?? "http://127.0.0.1:3313";
let pass = 0;
let fail = 0;
const ok = (n, c, e = "") => {
  if (c) {
    pass++;
    console.log(`PASS ${n}${e ? " | " + e : ""}`);
  } else {
    fail++;
    console.log(`FAIL ${n}${e ? " | " + e : ""}`);
  }
};

const student = await (
  await fetch(base + "/api/students", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "补课生", grade: "三年级" }),
  })
).json();

const courses = await (await fetch(base + "/api/courses")).json();
const courseId = courses[0].id;

const mk = await fetch(base + "/api/lessons", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    courseId,
    startAt: "2026-11-10 17:00",
    minutes: 90,
    studentIds: [student.id],
    title: "补课",
    status: "makeup",
  }),
});
const mkBody = await mk.json();
ok("makeup lesson created", mk.status === 201 && mkBody.status === "makeup", `status=${mkBody.status}`);

const search = await (await fetch(base + `/api/search?q=${encodeURIComponent("补课")}`)).json();
ok("search lessons hit", Array.isArray(search.lessons) && search.lessons.length > 0, `n=${search.lessons?.length}`);
ok("search students hit", search.students.length > 0);

const stats = await (await fetch(base + "/api/stats?months=6")).json();
ok("stats heatFrom", typeof stats.heatFrom === "string", stats.heatFrom);
ok("stats heatmap", Array.isArray(stats.heatmap) && stats.heatmap.length > 0, `days=${stats.heatmap?.length}`);

const sw = await fetch(base + "/sw.js");
ok("sw.js", sw.status === 200, `status=${sw.status}`);
const manifest = await (await fetch(base + "/manifest.json")).json();
ok("manifest name", manifest.name === "课后服务管理", manifest.start_url);

await fetch(base + `/api/students/${student.id}`, { method: "DELETE" });
await fetch(base + `/api/lessons/${mkBody.id}`, { method: "DELETE" });
console.log(`\n${pass} passed, ${fail} failed`);
