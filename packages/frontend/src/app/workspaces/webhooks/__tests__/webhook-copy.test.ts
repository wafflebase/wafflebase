import { describe, expect, it } from "vitest";

import {
  disabledExplanation,
  statusLabel,
  testResultLine,
  timeUntil,
  urlErrorMessage,
} from "../webhook-copy";
import { localUrlProblem } from "../webhook-form-values";

describe("urlErrorMessage (errors that teach)", () => {
  it("names the private address and the setting that allows it", () => {
    expect(urlErrorMessage("private_address", "10.0.4.12")).toBe(
      "This address resolves to a private network (10.0.4.12). Your server administrator can allow it by adding the range to WAFFLEBASE_WEBHOOK_ALLOWED_CIDRS.",
    );
  });

  it("still names the setting when the address is unknown", () => {
    expect(urlErrorMessage("private_address")).toMatch(
      /private network\. .*WAFFLEBASE_WEBHOOK_ALLOWED_CIDRS/,
    );
  });

  it("names the http setting for a plain-http URL", () => {
    expect(urlErrorMessage("scheme_not_allowed")).toMatch(
      /WAFFLEBASE_WEBHOOK_ALLOW_HTTP=true/,
    );
  });

  it("explains redirects instead of saying the URL is invalid", () => {
    expect(urlErrorMessage("redirect")).toMatch(/never follow redirects/);
  });

  it("falls back to the server's message for an unknown code", () => {
    expect(urlErrorMessage(null, null, "Something odd")).toBe("Something odd");
  });
});

describe("localUrlProblem", () => {
  it("accepts an https URL and an empty field", () => {
    expect(localUrlProblem("https://hooks.example.com/x")).toBeNull();
    expect(localUrlProblem("")).toBeNull();
  });

  it("leaves http to the server, which knows whether it is allowed", () => {
    expect(localUrlProblem("http://n8n.local/hook")).toBeNull();
  });

  it("flags other schemes, and garbage with an example", () => {
    expect(localUrlProblem("ftp://files.example.com/x")).toMatch(/https:\/\//);
    expect(localUrlProblem("not a url")).toMatch(/https:\/\/example\.com/);
  });
});

describe("testResultLine", () => {
  const base = {
    ok: true,
    status: 200,
    durationMs: 142,
    error: null,
    errorCode: null,
    responseExcerpt: null,
  };

  it("reports status and latency for a success", () => {
    expect(testResultLine(base)).toBe("Your endpoint answered 200 in 142 ms.");
  });

  it("says why a non-2xx answer is a failure", () => {
    expect(
      testResultLine({ ...base, ok: false, status: 302, durationMs: 1500 }),
    ).toBe(
      "Your endpoint answered 302 in 1.5 s. Only a 2xx response counts as delivered.",
    );
  });

  it("teaches from the error code when nothing answered", () => {
    expect(
      testResultLine({
        ...base,
        ok: false,
        status: null,
        durationMs: null,
        error: "timeout",
        errorCode: "timeout",
      }),
    ).toBe("The endpoint didn't answer within 10 seconds.");
  });
});

describe("status and disabled copy", () => {
  it("labels status with the reason", () => {
    expect(statusLabel("active", null)).toBe("Active");
    expect(statusLabel("disabled", "failing")).toBe("Off · failing");
    expect(statusLabel("disabled", "manual")).toBe("Off");
  });

  it("explains an automatic disable with the last response", () => {
    expect(
      disabledExplanation({
        disabledReason: "failing",
        lastDeliveryStatus: 502,
        createdBy: null,
      }),
    ).toBe(
      "Turned off automatically after 3 days of failed deliveries. Last response: 502.",
    );
  });

  it("tells another owner that re-enabling makes it theirs", () => {
    expect(
      disabledExplanation({
        disabledReason: "creator_removed",
        lastDeliveryStatus: null,
        createdBy: null,
      }),
    ).toMatch(/Re-enabling it makes you its owner/);
  });

  it("rounds a rotation overlap up to hours", () => {
    const now = Date.parse("2026-11-22T00:00:00Z");
    expect(timeUntil("2026-11-22T22:10:00Z", now)).toBe("23 h");
    expect(timeUntil("2026-11-22T00:30:00Z", now)).toBe("30 min");
  });
});
