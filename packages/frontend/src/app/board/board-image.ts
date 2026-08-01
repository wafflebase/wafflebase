import { uploadImageFile } from "@/app/spreadsheet/image-upload";

/**
 * Board image upload adapter: binds the workspace id and reshapes
 * `uploadImageFile`'s `{ id, url, width, height }` into the
 * `{ url, w, h }` contract `insertImageOnSlide` expects.
 */
export function makeBoardImageUpload(
  workspaceId: string,
): (file: File) => Promise<{ url: string; w: number; h: number }> {
  return async (file: File) => {
    const { url, width, height } = await uploadImageFile(file, workspaceId);
    return { url, w: width, h: height };
  };
}
