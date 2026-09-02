import type { Notification } from "@/api/notifications";
import { getDocumentPath } from "@/app/documents/document-list-utils";

/** Shown when the acting user has been deleted (`actor` is null). */
const UNKNOWN_ACTOR = "Someone";
/** Shown when a document row exists but carries no usable title. */
const UNTITLED_DOCUMENT = "a document";

/**
 * One line describing what happened, in the same voice across every type.
 * An unrecognized type falls back to a generic sentence rather than leaking
 * its raw value, so a backend that learns a new type ahead of the client
 * degrades instead of rendering `comment_something_new`.
 */
export function notificationSentence(n: Notification): string {
  const actor = n.actor?.username || UNKNOWN_ACTOR;
  const document = n.document?.title || UNTITLED_DOCUMENT;

  switch (n.type) {
    case "comment_mention":
      return `${actor} mentioned you in ${document}`;
    case "comment_reply":
      return `${actor} replied to your comment in ${document}`;
    case "thread_resolved":
      return `${actor} resolved your comment in ${document}`;
    case "workspace_member_joined":
      return `${actor} joined the workspace`;
    // The decision is the type, not a field — "your template was reviewed"
    // would make the reader open it to learn the one thing they want to know.
    case "template_approved":
      return `Your template ${document} is now in the public gallery`;
    case "template_rejected":
      return `Your template ${document} was not accepted into the gallery`;
    case "template_removed":
      return `Your template ${document} was removed from the gallery`;
    // No actor, and no "you": a collaborator or an editor-share-link holder
    // can change the document too, so naming the publisher as the editor would
    // often be wrong.
    case "template_needs_review":
      return `${document} left the public gallery for review after it changed`;
    // Reviewer-facing, so it names the queue rather than "your template".
    case "template_review_queued":
      return `${document} is waiting in the template review queue`;
    default:
      return `${actor} sent you a notification`;
  }
}

/**
 * Where clicking the notification goes, or null when it references no
 * document (a workspace join, or a document deleted since — the row cascades
 * away, but a stale list in an open dropdown can still hold one).
 */
export function notificationHref(n: Notification): string | null {
  if (!n.document) return null;
  return getDocumentPath({ id: n.document.id, type: n.document.type });
}
