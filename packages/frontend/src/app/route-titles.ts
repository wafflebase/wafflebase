import { matchPath } from "react-router-dom";

// Declarative route → title mapping. First match wins. `null` marks a page
// that writes its own title (Chat puts the channel and its unread count
// there). Layout must stay off it: a parent's effect runs after its
// child's, so writing here would overwrite the page on mount.
const ROUTE_TITLES: Array<{ path: string; title: string | null }> = [
  { path: "/w/:workspaceId/chat", title: null },
  { path: "/w/:workspaceId/chat/:channelId", title: null },
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
 * The tab title Layout writes for a path: a page name, `undefined` for an
 * unnamed route (plain "Wafflebase"), or `null` where the page owns it.
 */
export function routeTitle(pathname: string): string | null | undefined {
  return ROUTE_TITLES.find((r) => matchPath(r.path, pathname))?.title;
}
