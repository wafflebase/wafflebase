import { describe, expect, test, vi } from "vitest";
import { setUpServiceWorker } from "../../src/lib/service-worker";

function container() {
  const unregister = vi.fn(async () => true);
  return {
    register: vi.fn(async () => ({}) as ServiceWorkerRegistration),
    getRegistrations: vi.fn(async () => [
      { unregister } as unknown as ServiceWorkerRegistration,
    ]),
    unregister,
  };
}

describe("setUpServiceWorker", () => {
  test("registers sw.js at the base, bypassing the HTTP cache for updates", async () => {
    const c = container();
    await setUpServiceWorker({
      production: true,
      setting: undefined,
      base: "/",
      container: c as unknown as ServiceWorkerContainer,
    });
    expect(c.register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
  });

  test("does nothing in a dev build", async () => {
    const c = container();
    await setUpServiceWorker({
      production: false,
      setting: undefined,
      base: "/",
      container: c as unknown as ServiceWorkerContainer,
    });
    expect(c.register).not.toHaveBeenCalled();
    expect(c.getRegistrations).not.toHaveBeenCalled();
  });

  test("turned off, unregisters what an earlier build installed", async () => {
    const c = container();
    await setUpServiceWorker({
      production: true,
      setting: "off",
      base: "/",
      container: c as unknown as ServiceWorkerContainer,
    });
    expect(c.register).not.toHaveBeenCalled();
    expect(c.unregister).toHaveBeenCalled();
  });

  test("a browser without service workers, or a refused registration, is not an error", async () => {
    await expect(
      setUpServiceWorker({
        production: true,
        setting: undefined,
        base: "/",
        container: undefined,
      }),
    ).resolves.toBeUndefined();

    const c = container();
    c.register.mockRejectedValueOnce(new Error("SecurityError"));
    await expect(
      setUpServiceWorker({
        production: true,
        setting: undefined,
        base: "/",
        container: c as unknown as ServiceWorkerContainer,
      }),
    ).resolves.toBeUndefined();
  });
});
