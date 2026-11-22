import {
  documentApiUrl,
  documentUrl,
  type WebhookConfig,
} from './webhook-config';
import type {
  Actor,
  DocumentEventData,
  FolderPayload,
  FolderRef,
  MemberPayload,
} from './webhook.types';

/**
 * Pure builders for the `data` of each event family, so every emitter
 * describes a document, folder or member the same way. They return the
 * event-specific fields only; `WebhookEventService.emit` adds `workspace_id`
 * and `actor`.
 */

/** A user row as an actor. */
export function toActor(
  user: { id: number; username: string } | null | undefined,
): Actor | null {
  return user ? { id: user.id, username: user.username } : null;
}

export function toFolderRef(
  folder: { id: string; name: string } | null | undefined,
): FolderRef | null {
  return folder ? { id: folder.id, name: folder.name } : null;
}

/**
 * `{ document, url?, api_url? }` for a document event. `folder` is the
 * document's folder row (null at the root); links are omitted when the
 * deployment's origins are unknown.
 */
export function documentEventData(
  config: Pick<WebhookConfig, 'apiOrigin' | 'frontendOrigin'>,
  document: {
    id: string;
    type: string;
    title: string;
    workspaceId: string;
  },
  folder: { id: string; name: string } | null | undefined,
): Omit<DocumentEventData, 'workspace_id' | 'actor'> {
  const data: Omit<DocumentEventData, 'workspace_id' | 'actor'> = {
    document: {
      id: document.id,
      type: document.type,
      title: document.title,
      folder: toFolderRef(folder),
    },
  };
  const url = documentUrl(config, document);
  if (url) data.url = url;
  const apiUrl = documentApiUrl(config, document.workspaceId, document.id);
  if (apiUrl) data.api_url = apiUrl;
  return data;
}

export function folderEventData(folder: {
  id: string;
  name: string;
  parentId: string | null;
}): { folder: FolderPayload } {
  return {
    folder: { id: folder.id, name: folder.name, parent_id: folder.parentId },
  };
}

export function memberEventData(
  user: { id: number; username: string; email: string },
  role: string,
): { member: MemberPayload } {
  return {
    member: {
      id: user.id,
      username: user.username,
      email: user.email,
      role,
      kind: 'user',
    },
  };
}
