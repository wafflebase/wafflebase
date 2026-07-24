import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCommand } from "./command.mjs";

const cmd = (body, surface) => parseCommand(body, { surface }).command;

test("recognizes each verb regardless of trailing words", () => {
  assert.equal(cmd("@claude fix this issue", "issue"), "fix");
  assert.equal(cmd("@claude summarize this PR", "pr"), "summarize");
  assert.equal(cmd("@claude review this PR", "pr"), "review");
  assert.equal(cmd("@claude loop", "pr"), "loop");
  // bare verb, no trailing phrase
  assert.equal(cmd("@claude fix", "issue"), "fix");
});

test("matching is flexible: leading/trailing words and emoji don't matter", () => {
  assert.equal(cmd("please @claude fix this now", "issue"), "fix");
  assert.equal(cmd("hey @claude review 🙏 when you get a sec", "pr"), "review");
  assert.equal(cmd("@claude summarize\n\nthanks!", "pr"), "summarize");
});

test("case-insensitive on both the mention and the verb", () => {
  assert.equal(cmd("@Claude Review", "pr"), "review");
  assert.equal(cmd("@CLAUDE FIX IT", "issue"), "fix");
});

test("summarise (en-GB) normalizes to summarize", () => {
  assert.equal(cmd("@claude summarise the changes", "pr"), "summarize");
});

test("first recognized verb wins when several appear", () => {
  assert.equal(cmd("@claude review then maybe @claude fix", "pr"), "review");
  assert.equal(cmd("@claude fix but also @claude review", "pr"), "fix");
});

test("no collision: the new verbs never fall through to reply", () => {
  // Regression guard for the agent-review-reply.yml double-fire bug: a review /
  // summarize / loop comment on a PR must NOT parse as the generic `reply`.
  for (const body of ["@claude review this PR", "@claude summarize this PR", "@claude loop"]) {
    assert.notEqual(cmd(body, "pr"), "reply");
  }
});

test("mention without a recognized verb falls back by surface", () => {
  assert.equal(cmd("@claude looks good to me", "pr"), "reply");
  assert.equal(cmd("@claude can you take a look", "issue"), "help");
  // the verb must directly follow the mention — "please review" is not "@claude review"
  assert.equal(cmd("@claude please review this", "pr"), "reply");
  assert.equal(cmd("@claude", "issue"), "help");
});

test("no mention at all → none", () => {
  assert.equal(cmd("just a normal comment about the fix", "pr"), "none");
  assert.equal(cmd("", "pr"), "none");
  assert.equal(cmd(undefined, "pr"), "none");
});

test("surface defaults to pr when omitted", () => {
  assert.equal(parseCommand("@claude looks good").command, "reply");
});

test("rest carries the text after the command, trimmed", () => {
  assert.equal(parseCommand("@claude fix   focus on the parser bug").rest, "focus on the parser bug");
  assert.equal(parseCommand("@claude loop").rest, "");
});
