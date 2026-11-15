import { describe, expect, it } from "vitest";
import { isPrivatePath } from "./private-path";

describe("isPrivatePath", () => {
  it("matches signed-in routes", () => {
    for (const path of ["/w/acme", "/s/123", "/d/1", "/documents", "/settings"]) {
      expect(isPrivatePath(path, "")).toBe(true);
    }
  });

  it("leaves public routes alone", () => {
    for (const path of ["/", "/login", "/templates", "/t/1", "/shared/tok", "/harness/visual"]) {
      expect(isPrivatePath(path, "")).toBe(false);
    }
  });

  it("strips the router basename first", () => {
    expect(isPrivatePath("/app/s/1", "/app")).toBe(true);
    expect(isPrivatePath("/app/", "/app/")).toBe(false);
  });
});
