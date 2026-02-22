import { fetchWithAuth } from "./auth";

export type UploadedImageAsset = {
  key: string;
  contentType: string;
  size: number;
};

/**
 * Uploads an image file to the backend object storage.
 */
export async function uploadImageAsset(file: File): Promise<UploadedImageAsset> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetchWithAuth(
    `${import.meta.env.VITE_BACKEND_API_URL}/assets/images`,
    {
      method: "POST",
      body: formData,
    },
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message =
      payload &&
      typeof payload === "object" &&
      "message" in payload &&
      typeof payload.message === "string"
        ? payload.message
        : "Failed to upload image";
    throw new Error(message);
  }

  return response.json();
}
