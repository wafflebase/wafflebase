import { FormEvent, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Plus, Trash2 } from "lucide-react";

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
  type WorkspaceDetail,
  type WorkspaceInvite,
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
  const [editingName, setEditingName] = useState(false);
  const [editingSlug, setEditingSlug] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

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

  const { data: invites = [] } = useQuery<WorkspaceInvite[]>({
    queryKey: ["workspaces", workspaceId, "invites"],
    queryFn: () => fetchInvites(workspaceId!),
    enabled: !!workspaceId,
  });

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
  });

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; slug?: string }) =>
      updateWorkspace(workspaceId!, data),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setEditingName(false);
      if (editingSlug) {
        setEditingSlug(false);
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
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-gray-500 text-lg">Loading settings...</p>
      </div>
    );
  }

  if (isError) {
    if (isAuthExpiredError(error)) {
      return null;
    }
    return (
      <div className="flex flex-col items-center justify-center h-64">
        <p className="text-red-500 text-lg">Failed to load workspace.</p>
        <p className="text-gray-400">Please try again later.</p>
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
    <div className="p-4 max-w-2xl space-y-8">
      {/* Workspace Name */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Workspace Name</h2>
        {editingName ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              const formData = new FormData(e.target as HTMLFormElement);
              const name = (formData.get("name") as string).trim();
              if (name) updateMutation.mutate({ name });
            }}
          >
            <Input
              name="name"
              defaultValue={workspace.name}
              autoFocus
              className="max-w-sm"
            />
            <Button type="submit" disabled={updateMutation.isPending}>
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingName(false)}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm">{workspace.name}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditingName(true)}
            >
              Edit
            </Button>
          </div>
        )}
      </section>

      {/* Workspace URL */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Workspace URL</h2>
        {editingSlug ? (
          <form
            className="flex items-center gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              const formData = new FormData(e.target as HTMLFormElement);
              const slug = (formData.get("slug") as string).trim();
              if (slug) updateMutation.mutate({ slug });
            }}
          >
            <span className="text-sm text-muted-foreground">/w/</span>
            <Input
              name="slug"
              defaultValue={workspace.slug}
              autoFocus
              className="max-w-sm"
            />
            <Button type="submit" disabled={updateMutation.isPending}>
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingSlug(false)}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm">/w/{workspace.slug}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditingSlug(true)}
            >
              Edit
            </Button>
          </div>
        )}
      </section>

      {/* Members */}
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Members</h2>
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
                    {member.role !== "OWNER" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-600"
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

      {/* Invites */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Invites</h2>
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
                        className="text-red-500 hover:text-red-600"
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

      {/* Danger Zone */}
      {me &&
        workspace.members.some(
          (m) => m.user.id === me.id && m.role === "owner",
        ) && (
          <section className="space-y-2">
            <h2 className="text-lg font-semibold text-red-600">Danger Zone</h2>
            <div className="rounded-md border border-red-300 p-4">
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
    </div>
  );
}
