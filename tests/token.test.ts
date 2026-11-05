import assert from "node:assert/strict";
import { test } from "node:test";
import { sameToken, tokenFrom } from "../src/lib/token.ts";

test("tokenFrom 认 Bearer 头", () => {
  const req = new Request("http://127.0.0.1:3002/api/v1/students", {
    headers: { Authorization: "Bearer as_abc123" },
  });
  assert.equal(tokenFrom(req), "as_abc123");
});

test("tokenFrom 大小写不敏感、多余空格能吃掉", () => {
  const req = new Request("http://x/api/v1/students", {
    headers: { authorization: "bearer   as_abc123  " },
  });
  assert.equal(tokenFrom(req), "as_abc123");
});

test("tokenFrom 退回到 ?token=", () => {
  const req = new Request("http://x/api/v1/students?token=as_q9");
  assert.equal(tokenFrom(req), "as_q9");
});

test("tokenFrom 都没有就是空串", () => {
  assert.equal(tokenFrom(new Request("http://x/api/v1/students")), "");
});

test("sameToken 相等为真", () => {
  assert.equal(sameToken("as_1", "as_1"), true);
});

test("sameToken 不同为假", () => {
  assert.equal(sameToken("as_1", "as_2"), false);
});

test("sameToken 长度不同为假", () => {
  assert.equal(sameToken("as_1", "as_12"), false);
});

test("sameToken 空串一律为假", () => {
  assert.equal(sameToken("", ""), false);
  assert.equal(sameToken("", "as_1"), false);
  assert.equal(sameToken("as_1", ""), false);
});
