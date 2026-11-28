import { FormEvent, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Key, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { fetchMe, isAuthExpiredError } from "@/api/auth";
import { userFacingError } from "@/api/http-error";
import {
  fetchWorkspace,
  fetchWorkspaces,
  updateWorkspace,
  deleteWorkspace,
  fetchInvites,
  createInvite,
  revokeInvite,
  removeMember,
  fetchApiKeys,
  createApiKey,
  revokeApiKey,
  type WorkspaceDetail,
  type WorkspaceInvite,
  type ApiKey,
  type ApiKeyCreateResponse,
} from "@/api/workspaces";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { LoadErrorState } from "@/components/load-error-state";
import {
  DATASOURCES_SECTION_ID,
  WorkspaceDataSourcesSection,
} from "./workspace-datasources-section";
import { WorkspaceWebhooksSection } from "./webhooks/webhooks-section";
import { WEBHOOKS_SECTION_ID } from "./webhooks/webhook-paths";
import { RemoveMemberDialog } from "./webhooks/remove-member-dialog";
import { BotsSection } from "./bots/bots-section";
import { BOTS_SECTION_ID } from "./bots/bot-status";
import { CLI_DEFAULT_SERVER, apiServer } from "./cli-server";

const MEMBERS_SECTION_ID = "members";
const API_KEYS_SECTION_ID = "api-keys";

/** Sections the page scrolls to when the URL's hash names one. */
const ANCHORED_SECTIONS = [
  MEMBERS_SECTION_ID,
  API_KEYS_SECTION_ID,
  BOTS_SECTION_ID,
  DATASOURCES_SECTION_ID,
  WEBHOOKS_SECTION_ID,
];

/** The index at the top of the page: the long, list-shaped sections. */
const SECTION_INDEX = [
  { id: MEMBERS_SECTION_ID, label: "Members" },
  { id: API_KEYS_SECTION_ID, label: "API keys" },
  { id: BOTS_SECTION_ID, label: "Bots" },
  { id: DATASOURCES_SECTION_ID, label: "Data sources" },
  { id: WEBHOOKS_SECTION_ID, label: "Webhooks" },
];

/**
 * The shell lines that put a freshly minted key to work with the CLI and
 * the Claude Code plugin. The workspace goes in by id, not slug, so renaming
 * the workspace URL later does not break a script set up from here; the
 * server line appears only when this deployment is not the CLI's default.
 */
function cliSetupLines(key: string, workspaceId: string): string {
  const server = apiServer();
  const lines = [
    `export WAFFLEBASE_API_KEY=${key}`,
    `export WAFFLEBASE_WORKSPACE=${workspaceId}`,
  ];
  if (server !== CLI_DEFAULT_SERVER) {
    lines.push(`export WAFFLEBASE_SERVER=${server}`);
  }
  return lines.join("\n");
}

/**
 * Renders the workspace settings page with name editing, members, and invites.
 */
export default function WorkspaceSettings() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [createKeyDialogOpen, setCreateKeyDialogOpen] = useState(false);
  const [keyName, setKeyName] = useState("");
  const [revealedKey, setRevealedKey] = useState<ApiKeyCreateResponse | null>(
    null,
  );
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKey | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<{
    userId: number;
    username: string;
  } | null>(null);

  const {
    data: workspace,
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<WorkspaceDetail>({
    queryKey: ["workspaces", workspaceId],
    queryFn: () => fetchWorkspace(workspaceId!),
    enabled: !!workspaceId,
  });

  useEffect(() => {
    if (workspace) {
      setName(workspace.name);
      setSlug(workspace.slug);
    }
  }, [workspace]);

  // `/w/:id/datasources` redirects to `#datasources`, and webhook
  // notifications link to `#webhooks`. The browser's own anchor jump fires
  // before the page has data, so scroll once it renders.
  const loaded = !!workspace;
  useEffect(() => {
    const id = hash.slice(1);
    if (!loaded || !ANCHORED_SECTIONS.includes(id)) return;
    document.getElementById(id)?.scrollIntoView();
  }, [loaded, hash]);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
  });

  const isOwner =
    me &&
    workspace?.members.some((m) => m.user.id === me.id && m.role === "owner");

  const { data: invites = [] } = useQuery<WorkspaceInvite[]>({
    queryKey: ["workspaces", workspaceId, "invites"],
    queryFn: () => fetchInvites(workspaceId!),
    enabled: !!workspaceId && !!isOwner,
  });

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; slug?: string }) =>
      updateWorkspace(workspaceId!, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      if (updated.slug !== workspace?.slug) {
        navigate(`/w/${updated.slug}/settings`, { replace: true });
      }
      toast.success("Workspace updated");
    },
    onError: () => toast.error("Couldn't update the workspace"),
  });

  const createInviteMutation = useMutation({
    mutationFn: () => createInvite(workspaceId!),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "invites"],
      });
      toast.success("Invite link created");
    },
    onError: () => toast.error("Couldn't create the invite link"),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) => revokeInvite(workspaceId!, inviteId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "invites"],
      });
      toast.success("Invite link revoked");
    },
    onError: () => toast.error("Couldn't revoke the invite link"),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: number) => removeMember(workspaceId!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId],
      });
      // The removed member's webhooks were turned off with them.
      if (workspace) {
        queryClient.invalidateQueries({
          queryKey: ["workspaces", workspace.id, "webhooks"],
        });
      }
      setMemberToRemove(null);
      toast.success("Member removed");
    },
    onError: () => toast.error("Couldn't remove the member"),
  });

  // Every member mints and manages their own keys, so this is not gated on
  // ownership. The server narrows the listing to the caller's own keys unless
  // they own the workspace, in which case it returns all of them.
  const { data: apiKeys = [] } = useQuery<ApiKey[]>({
    queryKey: ["workspaces", workspaceId, "api-keys"],
    queryFn: () => fetchApiKeys(workspaceId!),
    enabled: !!workspaceId,
  });

  /** Resolves a key's creator to a display name for the owner-only column. */
  const creatorName = (userId: number) =>
    workspace?.members.find((m) => m.user.id === userId)?.user.username ??
    "Unknown";

  const createApiKeyMutation = useMutation({
    mutationFn: (data: { name: string }) => createApiKey(workspaceId!, data),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "api-keys"],
      });
      setCreateKeyDialogOpen(false);
      setKeyName("");
      setRevealedKey(result);
    },
    onError: () => toast.error("Couldn't create the API key"),
  });

  const revokeApiKeyMutation = useMutation({
    mutationFn: (keyId: string) => revokeApiKey(workspaceId!, keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "api-keys"],
      });
      setKeyToRevoke(null);
      toast.success("API key revoked");
    },
    onError: () => toast.error("Couldn't revoke the API key"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteWorkspace(workspaceId!),
    onSuccess: async () => {
      const remaining = await queryClient.fetchQuery({
        queryKey: ["workspaces"],
        queryFn: fetchWorkspaces,
      });
      if (remaining.length > 0) {
        navigate(`/w/${remaining[0].slug}`, { replace: true });
      } else {
        navigate("/", { replace: true });
      }
      toast.success("Workspace deleted");
    },
    onError: (err: Error) =>
      toast.error(
        userFacingError(
          err,
          "Couldn't delete the workspace. Try again in a moment.",
        ),
      ),
  });

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 max-w-2xl space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-9 w-64" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-9 w-64" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (isError) {
    if (isAuthExpiredError(error)) {
      return null;
    }
    return (
      <LoadErrorState
        title="Couldn't load the workspace."
        error={error}
        onRetry={() => void refetch()}
        isRetrying={isFetching}
        noAccessMessage="This workspace doesn't exist, or you no longer have access to it."
      />
    );
  }

  if (!workspace) return null;

  const copyInviteLink = (token: string) => {
    const link = `${window.location.origin}/invite/${token}`;
    navigator.clipboard.writeText(link);
    toast.success("Invite link copied");
  };

  return (
    <div className="p-4 lg:p-6 max-w-2xl space-y-8">
      <nav
        aria-label="Settings sections"
        className="flex flex-wrap gap-x-4 gap-y-1 text-sm"
      >
        {SECTION_INDEX.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:text-foreground"
          >
            {section.label}
          </a>
        ))}
      </nav>

      {/* Workspace name */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Workspace name</h2>
        <p className="text-sm text-muted-foreground">
          The display name of your workspace, visible to all members.
        </p>
        <form
          className="flex items-center gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const trimmed = name.trim();
            if (trimmed && trimmed !== workspace.name) {
              updateMutation.mutate({ name: trimmed });
            }
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="max-w-sm"
            aria-label="Workspace name"
          />
          {name.trim() !== workspace.name && name.trim() !== "" && (
            <Button type="submit" disabled={updateMutation.isPending}>
              Save
            </Button>
          )}
        </form>
      </section>

      <Separator />

      {/* Workspace URL */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Workspace URL</h2>
        <p className="text-sm text-muted-foreground">
          A unique URL slug used to access this workspace. Changing this will
          update all links.
        </p>
        <form
          className="flex items-center gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const trimmed = slug.trim();
            if (trimmed && trimmed !== workspace.slug) {
              updateMutation.mutate({ slug: trimmed });
            }
          }}
        >
          <span className="text-sm text-muted-foreground">/w/</span>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="max-w-sm"
            aria-label="Workspace URL slug"
          />
          {slug.trim() !== workspace.slug && slug.trim() !== "" && (
            <Button type="submit" disabled={updateMutation.isPending}>
              Save
            </Button>
          )}
        </form>
      </section>

      <Separator />

      {/* Members */}
      <section id={MEMBERS_SECTION_ID} className="scroll-mt-4 space-y-2">
        <h2 className="text-lg font-semibold">Members</h2>
        <p className="text-sm text-muted-foreground">
          People who have access to this workspace.
        </p>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspace.members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      {member.user.username}
                      {member.user.kind === "bot" && (
                        <Badge variant="outline">Bot</Badge>
                      )}
                    </span>
                  </TableCell>
                  {/* Wraps instead of nowrap so a long address cannot push
                      the Actions column off a phone-width screen. */}
                  <TableCell className="text-muted-foreground whitespace-normal [overflow-wrap:anywhere]">
                    {member.user.email}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{member.role}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {member.role !== "owner" &&
                      (isOwner || member.user.id === me?.id) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          aria-label="Remove member"
                          onClick={() =>
                            setMemberToRemove({
                              userId: member.user.id,
                              username: member.user.username,
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Invites — owner-only: listing invites is owner-gated too. */}
      {isOwner && (
        <>
          <Separator />

          <section className="space-y-2">
            <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Invites</h2>
                <p className="text-sm text-muted-foreground">
                  Manage pending invitations to this workspace.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => createInviteMutation.mutate()}
                disabled={createInviteMutation.isPending}
                className="flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Create invite link
              </Button>
            </div>
            {invites.length > 0 ? (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Role</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.map((invite) => (
                      <TableRow key={invite.id}>
                        <TableCell>
                          <Badge variant="secondary">{invite.role}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {invite.expiresAt
                            ? new Date(invite.expiresAt).toLocaleDateString()
                            : "Never"}
                        </TableCell>
                        <TableCell className="text-right space-x-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label="Copy invite link"
                            onClick={() => copyInviteLink(invite.token)}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            aria-label="Revoke invite"
                            onClick={() =>
                              revokeInviteMutation.mutate(invite.id)
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No active invites.</p>
            )}
          </section>
        </>
      )}

      {/* API Keys */}
      <Separator />
      <section id={API_KEYS_SECTION_ID} className="scroll-mt-4 space-y-2">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">API keys</h2>
            <p className="text-sm text-muted-foreground">
              {isOwner
                ? "Create API keys for programmatic access via the CLI or REST API. As the workspace owner you can see and revoke every member's keys."
                : "Create API keys for programmatic access via the CLI or REST API. A key acts as you, and only you and the workspace owner can see it."}
            </p>
          </div>
          {/* One primary per screen (DESIGN.md, the One Accent Rule): an
              owner also sees "Create invite link", which is the page's main
              action, so this one steps down to outline beside it. */}
          <Button
            size="sm"
            variant={isOwner ? "outline" : "default"}
            onClick={() => setCreateKeyDialogOpen(true)}
            className="flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create API key
          </Button>
        </div>
        {apiKeys.length > 0 ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  {isOwner && <TableHead>Created by</TableHead>}
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((apiKey) => (
                  <TableRow key={apiKey.id}>
                    <TableCell>{apiKey.name}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">
                      {apiKey.prefix}…
                    </TableCell>
                    {isOwner && (
                      <TableCell className="text-sm text-muted-foreground">
                        {creatorName(apiKey.createdBy)}
                      </TableCell>
                    )}
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(apiKey.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {apiKey.lastUsedAt
                        ? new Date(apiKey.lastUsedAt).toLocaleDateString()
                        : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Revoke API key ${apiKey.name}`}
                        onClick={() => setKeyToRevoke(apiKey)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No API keys.</p>
        )}
      </section>

      <Separator />
      <BotsSection
        workspaceId={workspace.id}
        meId={me?.id}
        isOwner={!!isOwner}
        onMembersChanged={() =>
          void queryClient.invalidateQueries({
            queryKey: ["workspaces", workspaceId],
            exact: true,
          })
        }
      />

      <Separator />
      <WorkspaceDataSourcesSection workspaceId={workspaceId!} />

      <Separator />
      <WorkspaceWebhooksSection
        workspaceId={workspace.id}
        workspaceRef={workspaceId!}
      />

      {/* Delete workspace */}
      {isOwner && <Separator />}
      {isOwner && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-destructive">Delete workspace</h2>
            <div className="rounded-md border border-destructive/30 p-4">
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-medium">Delete this workspace</p>
                  <p className="text-sm text-muted-foreground">
                    Once deleted, all documents, data sources, and member
                    associations will be permanently removed.
                  </p>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  Delete this workspace
                </Button>
              </div>
            </div>
          </section>
        )}

      <Dialog
        open={!!keyToRevoke}
        onOpenChange={(open) => {
          if (!open) setKeyToRevoke(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke {keyToRevoke?.name ?? ""}</DialogTitle>
            <DialogDescription>
              Anything using this key — a script, the CLI, an agent — stops
              working right away. This can't be undone; you can create a new
              key instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setKeyToRevoke(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={revokeApiKeyMutation.isPending}
              onClick={() =>
                keyToRevoke && revokeApiKeyMutation.mutate(keyToRevoke.id)
              }
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RemoveMemberDialog
        workspaceId={workspace.id}
        member={memberToRemove}
        isSelf={memberToRemove?.userId === me?.id}
        pending={removeMemberMutation.isPending}
        onCancel={() => setMemberToRemove(null)}
        onConfirm={() => {
          if (memberToRemove) removeMemberMutation.mutate(memberToRemove.userId);
        }}
      />

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setDeleteConfirmName("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete workspace</DialogTitle>
            <DialogDescription>
              This will permanently delete{" "}
              <strong>{workspace.name}</strong> and all its data. This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (deleteConfirmName !== workspace.name) return;
              deleteMutation.mutate();
            }}
          >
            <label
              htmlFor="delete-confirm"
              className="text-sm text-muted-foreground"
            >
              Type <strong>{workspace.name}</strong> to confirm:
            </label>
            <Input
              id="delete-confirm"
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              className="mt-2"
              autoFocus
            />
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDeleteDialogOpen(false);
                  setDeleteConfirmName("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                disabled={
                  deleteConfirmName !== workspace.name ||
                  deleteMutation.isPending
                }
              >
                Delete workspace
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create API key dialog */}
      <Dialog
        open={createKeyDialogOpen}
        onOpenChange={(open) => {
          setCreateKeyDialogOpen(open);
          if (!open) setKeyName("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              The key acts as you, with your access to this workspace.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              const trimmed = keyName.trim();
              if (trimmed) {
                createApiKeyMutation.mutate({ name: trimmed });
              }
            }}
          >
            <Input
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
              placeholder="e.g. CI pipeline"
              aria-label="API key name"
              autoFocus
            />
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreateKeyDialogOpen(false);
                  setKeyName("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  !keyName.trim() || createApiKeyMutation.isPending
                }
              >
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reveal API Key dialog */}
      <Dialog
        open={!!revealedKey}
        onOpenChange={(open) => {
          if (!open) setRevealedKey(null);
        }}
      >
        {/* Escape or a stray click outside would throw the key away for
            good, so only Done (or the close button) dismisses it. */}
        <DialogContent
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>API key created</DialogTitle>
            <DialogDescription>
              Copy your key now. It is shown only once.
            </DialogDescription>
          </DialogHeader>
          <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>Workspace: {workspace.name}</span>
            <span className="[overflow-wrap:anywhere]">
              Server: {apiServer()}
            </span>
          </p>
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
            <Key className="h-4 w-4 shrink-0 text-muted-foreground" />
            <code className="flex-1 text-sm break-all">
              {revealedKey?.key}
            </code>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Copy API key"
              onClick={() => {
                if (revealedKey) {
                  navigator.clipboard.writeText(revealedKey.key);
                  toast.success("API key copied");
                }
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          {revealedKey && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                To use it with the CLI or the Claude Code plugin, run:
              </p>
              <div className="flex items-start gap-2 rounded-md border bg-muted p-3">
                <pre
                  aria-label="CLI setup"
                  className="flex-1 whitespace-pre-wrap font-mono text-xs leading-relaxed [overflow-wrap:anywhere]"
                >
                  {cliSetupLines(revealedKey.key, workspace.id)}
                </pre>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Copy CLI setup"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      cliSetupLines(revealedKey.key, workspace.id),
                    );
                    toast.success("CLI setup copied");
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                Start Claude Code from that same shell. The lines last only as
                long as the shell; keep the key itself in a password manager.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setRevealedKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
