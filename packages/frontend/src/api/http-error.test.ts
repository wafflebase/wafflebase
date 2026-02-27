import assert from "node:assert/strict";
import test from "node:test";
import { assertOk, readResponseErrorMessage } from "./http-error.ts";

test("readResponseErrorMessage reads JSON message string", async () => {
  const response = new Response(JSON.stringify({ message: "Bad request" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });

  const message = await readResponseErrorMessage(response);
  assert.equal(message, "Bad request");
});

test("readResponseErrorMessage joins JSON message arrays", async () => {
  const response = new Response(
    JSON.stringify({ message: ["a", "b", "  ", null] }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" },
    },
  );

  const message = await readResponseErrorMessage(response);
  assert.equal(message, "a, b");
});

test("readResponseErrorMessage falls back to trimmed text body", async () => {
  const response = new Response("  plain failure  ", { status: 500 });
  const message = await readResponseErrorMessage(response);
  assert.equal(message, "plain failure");
});

test("assertOk uses status override before response body", async () => {
  const response = new Response(JSON.stringify({ message: "ignored" }), {
    status: 410,
    headers: { "Content-Type": "application/json" },
  });

  await assert.rejects(
    () =>
      assertOk(response, "fallback", {
        statusMessages: { 410: "expired" },
      }),
    /expired/,
  );
});

test("assertOk uses body message then fallback", async () => {
  const withMessage = new Response(JSON.stringify({ error: "detail" }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
  await assert.rejects(() => assertOk(withMessage, "fallback"), /detail/);

  const emptyBody = new Response("", { status: 400 });
  await assert.rejects(() => assertOk(emptyBody, "fallback"), /fallback/);
});

test("assertOk does not throw for OK responses", async () => {
  const response = new Response(JSON.stringify({ ok: true }), { status: 200 });
  await assert.doesNotReject(() => assertOk(response, "fallback"));
});
