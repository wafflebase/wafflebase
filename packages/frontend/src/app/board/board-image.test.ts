import { describe, it, expect, vi } from "vitest";

vi.mock("@/app/spreadsheet/image-upload", () => ({
  uploadImageFile: vi
    .fn()
    .mockResolvedValue({ id: "x", url: "http://h/u.png", width: 320, height: 240 }),
}));

import { makeBoardImageUpload } from "./board-image";
import { uploadImageFile } from "@/app/spreadsheet/image-upload";

describe("makeBoardImageUpload", () => {
  it("uploads with the workspace id and maps width/height → w/h", async () => {
    const upload = makeBoardImageUpload("ws-1");
    const out = await upload({} as File);
    expect(uploadImageFile).toHaveBeenCalledWith(expect.anything(), "ws-1");
    expect(out).toEqual({ url: "http://h/u.png", w: 320, h: 240 });
  });
});
