import { useEffect, useState } from "react";
import { getSnapshot, subscribe, type UploadItem } from "./upload-queue";

export function useUploadQueue(): readonly UploadItem[] {
  const [items, setItems] = useState<readonly UploadItem[]>(getSnapshot());
  useEffect(() => subscribe(() => setItems(getSnapshot())), []);
  return items;
}
