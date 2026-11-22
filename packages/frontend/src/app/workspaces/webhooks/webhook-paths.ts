/** Routes, anchors and query keys the webhook screens share. */

/** The `id` the settings page scrolls to for `#webhooks`. */
export const WEBHOOKS_SECTION_ID = "webhooks";

/** Query key of a workspace's webhook list, shared with the detail page. */
export const webhooksQueryKey = (workspaceId: string) => [
  "workspaces",
  workspaceId,
  "webhooks",
];

/** Where a webhook's detail page lives. `workspaceRef` is the URL's id/slug. */
export function webhookDetailPath(workspaceRef: string, webhookId: string) {
  return `/w/${encodeURIComponent(workspaceRef)}/settings/webhooks/${encodeURIComponent(webhookId)}`;
}

/** Query key prefix of a webhook's delivery log; filters extend it. */
export const deliveriesQueryKey = (workspaceId: string, webhookId: string) => [
  "workspaces",
  workspaceId,
  "webhooks",
  webhookId,
  "deliveries",
];
