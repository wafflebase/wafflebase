import { matchPath } from "react-router-dom";

// Declarative route → title mapping. First match wins. `pageOwnsTab` marks a
// page that writes the browser tab's title itself (Chat puts the channel and
// its unread count there). Layout must stay off the tab there — a parent's
// effect runs after its child's, so writing it would overwrite the page on
// mount — but still shows `title` in the header.
const ROUTE_TITLES: Array<{
  path: string;
  title: string;
  pageOwnsTab?: boolean;
}> = [
  { path: "/w/:workspaceId/chat", title: "Chat", pageOwnsTab: true },
  { path: "/w/:workspaceId/chat/:channelId", title: "Chat", pageOwnsTab: true },
  { path: "/w/:workspaceId/analytics", title: "Analytics" },
  { path: "/w/:workspaceId/analytics/:id", title: "Document analytics" },
  { path: "/w/:workspaceId/templates", title: "Templates" },
  { path: "/w/:workspaceId/settings", title: "Settings" },
  { path: "/w/:workspaceId/settings/webhooks/:webhookId", title: "Webhook" },
  { path: "/w/:workspaceId/trash", title: "Trash" },
  { path: "/w/:workspaceId", title: "Documents" },
  { path: "/settings", title: "Settings" },
  { path: "/documents", title: "Documents" },
  { path: "/", title: "Documents" },
];

/**
 * The header title for a path ("" for an unnamed route), and whether the page
 * there writes the tab title itself.
 */
export function routeTitle(pathname: string): {
  title: string;
  pageOwnsTab: boolean;
} {
  const route = ROUTE_TITLES.find((r) => matchPath(r.path, pathname));
  return { title: route?.title ?? "", pageOwnsTab: !!route?.pageOwnsTab };
}
