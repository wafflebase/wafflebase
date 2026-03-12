import { FormEvent, useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
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

/**
 * Renders the workspace settings page with name editing, members, and invites.
 */
export default function WorkspaceSettings() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
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

  const {
    data: workspace,
    isLoading,
    isError,
    error,
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

  const { data: invites = [] } = useQuery<WorkspaceInvite[]>({
    queryKey: ["workspaces", workspaceId, "invites"],
    queryFn: () => fetchInvites(workspaceId!),
    enabled: !!workspaceId,
  });

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
  });

  const isOwner =
    me &&
    workspace?.members.some((m) => m.user.id === me.id && m.role === "owner");

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
    onError: () => toast.error("Failed to update workspace"),
  });

  const createInviteMutation = useMutation({
    mutationFn: () => createInvite(workspaceId!),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "invites"],
      });
      toast.success("Invite created");
    },
    onError: () => toast.error("Failed to create invite"),
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) => revokeInvite(workspaceId!, inviteId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "invites"],
      });
      toast.success("Invite revoked");
    },
    onError: () => toast.error("Failed to revoke invite"),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: number) => removeMember(workspaceId!, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId],
      });
      toast.success("Member removed");
    },
    onError: () => toast.error("Failed to remove member"),
  });

  const { data: apiKeys = [] } = useQuery<ApiKey[]>({
    queryKey: ["workspaces", workspaceId, "api-keys"],
    queryFn: () => fetchApiKeys(workspaceId!),
    enabled: !!workspaceId && !!isOwner,
  });

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
    onError: () => toast.error("Failed to create API key"),
  });

  const revokeApiKeyMutation = useMutation({
    mutationFn: (keyId: string) => revokeApiKey(workspaceId!, keyId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["workspaces", workspaceId, "api-keys"],
      });
      toast.success("API key revoked");
    },
    onError: () => toast.error("Failed to revoke API key"),
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
      toast.error(err.message || "Failed to delete workspace"),
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
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-destructive text-lg">Failed to load workspace.</p>
        <p className="text-sm text-muted-foreground">Please try again later.</p>
      </div>
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
      {/* Workspace Name */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Workspace Name</h2>
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
      <section className="space-y-2">
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
                  <TableCell>{member.user.username}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {member.user.email}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{member.role}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {member.role !== "owner" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() =>
                          removeMemberMutation.mutate(member.user.id)
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

      <Separator />

      {/* Invites */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
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
            Create Invite
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
                        onClick={() => copyInviteLink(invite.token)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
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

      {/* API Keys */}
      {isOwner && (
        <>
          <Separator />
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold">API Keys</h2>
                <p className="text-sm text-muted-foreground">
                  Create API keys for programmatic access via the CLI or REST
                  API.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => setCreateKeyDialogOpen(true)}
                className="flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Create API Key
              </Button>
            </div>
            {apiKeys.length > 0 ? (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Key</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Last Used</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {apiKeys.map((apiKey) => (
                      <TableRow key={apiKey.id}>
                        <TableCell>{apiKey.name}</TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {apiKey.prefix}...
                        </TableCell>
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
                            onClick={() =>
                              revokeApiKeyMutation.mutate(apiKey.id)
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
              <p className="text-sm text-muted-foreground">No API keys.</p>
            )}
          </section>
        </>
      )}

      {/* Danger Zone */}
      {isOwner && <Separator />}
      {isOwner && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-destructive">Danger Zone</h2>
            <div className="rounded-md border border-destructive/30 p-4">
              <div className="flex items-center justify-between">
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
            <label className="text-sm text-muted-foreground">
              Type <strong>{workspace.name}</strong> to confirm:
            </label>
            <Input
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

      {/* Create API Key dialog */}
      <Dialog
        open={createKeyDialogOpen}
        onOpenChange={(open) => {
          setCreateKeyDialogOpen(open);
          if (!open) setKeyName("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              Enter a name to identify this key.
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>
              Copy your key now. It will only be shown once.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
            <Key className="h-4 w-4 shrink-0 text-muted-foreground" />
            <code className="flex-1 text-sm break-all">
              {revealedKey?.key}
            </code>
            <Button
              variant="ghost"
              size="sm"
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
          <DialogFooter>
            <Button onClick={() => setRevealedKey(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
