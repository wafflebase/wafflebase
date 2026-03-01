import { FormEvent, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { isAuthExpiredError } from "@/api/auth";
import {
  fetchWorkspace,
  updateWorkspace,
  fetchInvites,
  createInvite,
  revokeInvite,
  removeMember,
  type WorkspaceDetail,
  type WorkspaceInvite,
} from "@/api/workspaces";

/**
 * Renders the workspace settings page with name editing, members, and invites.
 */
export default function WorkspaceSettings() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const queryClient = useQueryClient();
  const [editingName, setEditingName] = useState(false);

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

  const updateMutation = useMutation({
    mutationFn: (data: { name: string }) =>
      updateWorkspace(workspaceId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      setEditingName(false);
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
    </div>
  );
}
