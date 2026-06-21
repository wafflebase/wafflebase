import { describe, expect, it } from "vitest";
import { mapPresenceToPeerView } from "@/app/slides/peer-view";
import type { SlidesPresence } from "@/types/users";

function presence(over: Partial<SlidesPresence>): SlidesPresence {
  return {
    username: "Ada",
    email: "ada@example.com",
    photo: "",
    ...over,
  };
}

describe("mapPresenceToPeerView", () => {
  it("maps a peer on a slide into a PeerView with a stable colour", () => {
    const out = mapPresenceToPeerView(
      [
        {
          clientID: "c1",
          presence: presence({
            activeSlideId: "s1",
            selectedElementIds: ["e1"],
          }),
        },
      ],
      "light",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      clientID: "c1",
      label: "Ada",
      activeSlideId: "s1",
      selectedElementIds: ["e1"],
    });
    expect(typeof out[0].color).toBe("string");
    expect(out[0].color.length).toBeGreaterThan(0);
  });

  it("assigns the same client id the same colour deterministically", () => {
    const mk = () =>
      mapPresenceToPeerView(
        [{ clientID: "c1", presence: presence({ activeSlideId: "s1" }) }],
        "dark",
      )[0].color;
    expect(mk()).toBe(mk());
  });

  it("drops peers with no activeSlideId", () => {
    const out = mapPresenceToPeerView(
      [{ clientID: "c1", presence: presence({}) }],
      "light",
    );
    expect(out).toEqual([]);
  });

  it("falls back to 'Anonymous' when the username is empty", () => {
    const out = mapPresenceToPeerView(
      [
        {
          clientID: "c1",
          presence: presence({ username: "", activeSlideId: "s1" }),
        },
      ],
      "light",
    );
    expect(out[0].label).toBe("Anonymous");
  });

  it("forwards live activeFrames and draggingGuide", () => {
    const out = mapPresenceToPeerView(
      [
        {
          clientID: "c1",
          presence: presence({
            activeSlideId: "s1",
            activeFrames: [
              { elementId: "e1", x: 1, y: 2, w: 3, h: 4, rotation: 0 },
            ],
            draggingGuide: { axis: "x", position: 120 },
          }),
        },
      ],
      "light",
    );
    expect(out[0].activeFrames).toEqual([
      { elementId: "e1", x: 1, y: 2, w: 3, h: 4, rotation: 0 },
    ]);
    expect(out[0].draggingGuide).toEqual({ axis: "x", position: 120 });
  });
});
