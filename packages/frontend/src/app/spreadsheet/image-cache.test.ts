import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  getOrLoadImage,
  resolveImageSrc,
  setImageUrlResolver,
} from "./image-cache";

/**
 * The sheets image cache's src → fetch-URL seam. A shared-link mount installs
 * a resolver that appends its `?token=` to workspace image URLs so anonymous
 * viewers can load them; without it every image in a shared sheet 403s (the
 * deferred half of PR #955).
 */
describe("sheets image URL resolver", () => {
  /** Every `Image` the module constructs during one test. */
  let built: HTMLImageElement[];
  const RealImage = globalThis.Image;

  beforeEach(() => {
    built = [];
    globalThis.Image = class extends RealImage {
      constructor() {
        super();
        built.push(this as unknown as HTMLImageElement);
      }
    } as unknown as typeof Image;
  });

  afterEach(() => {
    globalThis.Image = RealImage;
    setImageUrlResolver(null);
  });

  /** A src no other test has cached, so each case starts cold. */
  const freshSrc = () =>
    `https://api.example.com/images/${crypto.randomUUID()}.png`;

  it("resolves to the src itself by default", () => {
    const src = freshSrc();
    expect(resolveImageSrc(src)).toBe(src);
  });

  it("applies the installed resolver", () => {
    setImageUrlResolver((src) => `${src}?token=t1`);
    const src = freshSrc();
    expect(resolveImageSrc(src)).toBe(`${src}?token=t1`);
  });

  it("restores identity when cleared", () => {
    setImageUrlResolver((src) => `${src}?token=t1`);
    setImageUrlResolver(null);
    const src = freshSrc();
    expect(resolveImageSrc(src)).toBe(src);
  });

  it("points the browser at the resolved URL, not the stored src", () => {
    setImageUrlResolver((src) => `${src}?token=t1`);
    const stored = freshSrc();

    expect(getOrLoadImage(stored)).toBeNull(); // load is in flight
    expect(built).toHaveLength(1);
    expect(built[0].getAttribute("src")).toBe(`${stored}?token=t1`);
  });

  it("keys the cache by resolved URL, so a repeat call reuses the load", () => {
    setImageUrlResolver((src) => `${src}?token=t1`);
    const stored = freshSrc();

    getOrLoadImage(stored);
    getOrLoadImage(stored);

    // Second call hit the cache rather than starting a second fetch — which
    // only holds if both calls derived the same key from the resolver.
    expect(built).toHaveLength(1);
  });

  it("does not reuse an entry cached under a different token", () => {
    const stored = freshSrc();

    setImageUrlResolver((src) => `${src}?token=first`);
    getOrLoadImage(stored);
    setImageUrlResolver((src) => `${src}?token=second`);
    getOrLoadImage(stored);

    expect(built.map((i) => i.getAttribute("src"))).toEqual([
      `${stored}?token=first`,
      `${stored}?token=second`,
    ]);
  });
});
