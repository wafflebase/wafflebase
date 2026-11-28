import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Plus, Trash2 } from 'lucide-react';

import {
  createBot,
  createPairingCode,
  deleteBot,
  fetchBots,
  type BotDto,
  type PairingCode,
} from '@/api/bots';
import { userFacingError } from '@/api/http-error';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { CLI_DEFAULT_SERVER, apiServer } from '../cli-server';
import {
  BOT_NAME_PATTERN,
  BOTS_SECTION_ID,
  CONNECT_POLL_MS,
  hostStatus,
} from './bot-status';

/** The shell line that pairs a server-side host, with `--server` off-default. */
function serverPairCommand(code: string): string {
  const server = apiServer();
  const flag = server === CLI_DEFAULT_SERVER ? '' : ` --server ${server}`;
  return `wafflebase${flag} agent pair ${code}`;
}

/** The bot a Connect dialog is open for, and the code it is showing. */
type Connecting = { botId: number; name: string; code: PairingCode | null };

/**
 * Workspace settings section for bot members: create one, connect it to a
 * host with a pairing code, see whether a host is listening, delete it.
 *
 * Any member may create a bot; its owner and workspace owners manage it
 * (docs/design/chat.md § Bot Members). `workspaceId` is the real id.
 * A bot is a workspace member, so creating or deleting one calls
 * `onMembersChanged` for the page to re-read its member list.
 */
export function BotsSection({
  workspaceId,
  meId,
  isOwner,
  onMembersChanged,
}: {
  workspaceId: string;
  meId: number | undefined;
  isOwner: boolean;
  onMembersChanged?: () => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ['workspaces', workspaceId, 'bots'];
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [connecting, setConnecting] = useState<Connecting | null>(null);
  const [botToDelete, setBotToDelete] = useState<BotDto | null>(null);

  const {
    data: bots = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useQuery<BotDto[]>({
    queryKey,
    queryFn: () => fetchBots(workspaceId),
    // While the Connect dialog waits for a host, re-read every few seconds
    // and stop once one is listening.
    refetchInterval: (query) => {
      if (!connecting) return false;
      const bot = query.state.data?.find((b) => b.id === connecting.botId);
      return bot && hostStatus(bot.lastSeenAt).state === 'listening'
        ? false
        : CONNECT_POLL_MS;
    },
  });

  const canManage = (bot: BotDto) => isOwner || bot.owner?.id === meId;

  const pairMutation = useMutation({
    mutationFn: (botId: number) => createPairingCode(workspaceId, botId),
    onSuccess: (code, botId) =>
      setConnecting((prev) =>
        prev && prev.botId === botId ? { ...prev, code } : prev,
      ),
    onError: (err: Error) =>
      toast.error(userFacingError(err, "Couldn't create a pairing code")),
  });

  const openConnect = (bot: { id: number; username: string }) => {
    setConnecting({ botId: bot.id, name: bot.username, code: null });
    pairMutation.mutate(bot.id);
  };

  const createMutation = useMutation({
    mutationFn: (botName: string) => createBot(workspaceId, botName),
    onSuccess: (bot) => {
      void queryClient.invalidateQueries({ queryKey });
      onMembersChanged?.();
      setCreateOpen(false);
      setName('');
      openConnect(bot);
    },
    onError: (err: Error) =>
      toast.error(userFacingError(err, "Couldn't create the bot")),
  });

  const deleteMutation = useMutation({
    mutationFn: (botId: number) => deleteBot(workspaceId, botId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      onMembersChanged?.();
      setBotToDelete(null);
      toast.success('Bot deleted');
    },
    onError: (err: Error) =>
      toast.error(userFacingError(err, "Couldn't delete the bot")),
  });

  const trimmed = name.trim();
  const nameValid = BOT_NAME_PATTERN.test(trimmed);
  const connectingBot = connecting
    ? bots.find((b) => b.id === connecting.botId)
    : undefined;
  const connectStatus = hostStatus(connectingBot?.lastSeenAt ?? null);
  const code = connecting?.code ?? null;
  const expired = !!code && new Date(code.expiresAt).getTime() <= Date.now();

  return (
    <section id={BOTS_SECTION_ID} className="scroll-mt-4 space-y-2">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Bots</h2>
          <p className="text-sm text-muted-foreground">
            Members that answer when you mention them in chat, run by a Claude
            Code session or a server you connect.
          </p>
        </div>
        {/* Outline, like Data sources: "Create invite link" stays the
            page's one primary action (DESIGN.md, the One Accent Rule). */}
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCreateOpen(true)}
          className="flex shrink-0 items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          New bot
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3 rounded-md border p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">
          Couldn't load bots.{' '}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </p>
      ) : bots.length > 0 ? (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Host</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bots.map((bot) => (
                <TableRow key={bot.id}>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      {bot.username}
                      <Badge variant="outline">Bot</Badge>
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {!bot.owner
                      ? '—'
                      : bot.owner.id === meId
                        ? 'You'
                        : bot.owner.username}
                  </TableCell>
                  <TableCell
                    aria-live="polite"
                    className="text-sm text-muted-foreground"
                  >
                    {hostStatus(bot.lastSeenAt).text}
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    {canManage(bot) && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Connect ${bot.username}`}
                          onClick={() => openConnect(bot)}
                        >
                          Connect
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          aria-label={`Delete ${bot.username}`}
                          onClick={() => setBotToDelete(bot)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No bots yet. Create one, connect it, and mention it in a channel.
        </p>
      )}

      {/* New bot */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setName('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New bot</DialogTitle>
            <DialogDescription>
              A bot is a member of this workspace with your access. You manage
              it; workspace owners can too.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (nameValid) createMutation.mutate(trimmed);
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="bot-name">Bot name</Label>
              <Input
                id="bot-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. helper"
                aria-describedby="bot-name-hint"
                autoComplete="off"
                autoFocus
              />
              <p id="bot-name-hint" className="text-xs text-muted-foreground">
                Lowercase letters, numbers and hyphens, 2 to 32 characters.
                People mention it as @name.
              </p>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Who will mention this bot?
              </legend>
              <RadioGroup value="owner" aria-label="Who will mention this bot?">
                <div className="flex items-center gap-2">
                  <RadioGroupItem value="owner" id="bot-invokers-owner" />
                  <Label htmlFor="bot-invokers-owner" className="font-normal">
                    Just me
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem
                    value="members"
                    id="bot-invokers-members"
                    disabled
                    aria-describedby="bot-invokers-members-hint"
                    className="mt-0.5"
                  />
                  <div className="space-y-1">
                    <Label
                      htmlFor="bot-invokers-members"
                      className="font-normal"
                    >
                      Any member
                    </Label>
                    <p
                      id="bot-invokers-members-hint"
                      className="text-xs text-muted-foreground"
                    >
                      Available with team bots
                    </p>
                  </div>
                </div>
              </RadioGroup>
            </fieldset>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setCreateOpen(false);
                  setName('');
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!nameValid || createMutation.isPending}
              >
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Connect */}
      <Dialog
        open={!!connecting}
        onOpenChange={(open) => {
          if (!open) setConnecting(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Connect {connecting?.name ?? ''}</DialogTitle>
            <DialogDescription>
              Give this code to the Claude Code session or server that will
              answer as the bot. It works once.
            </DialogDescription>
          </DialogHeader>
          {code ? (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
                <code
                  aria-label="Pairing code"
                  className="flex-1 font-mono text-2xl font-semibold tracking-wider"
                >
                  {code.code}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label="Copy pairing code"
                  onClick={() => {
                    void navigator.clipboard.writeText(code.code);
                    toast.success('Pairing code copied');
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {expired
                  ? 'This code has expired. Get a new one.'
                  : `Expires at ${new Date(code.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`}
              </p>
              <div className="space-y-1">
                <p className="text-sm">In Claude Code:</p>
                <pre className="whitespace-pre-wrap rounded-md border bg-muted p-3 font-mono text-xs [overflow-wrap:anywhere]">
                  {`/wafflebase:listen ${code.code}`}
                </pre>
              </div>
              <div className="space-y-1">
                <p className="text-sm">On a server:</p>
                <pre className="whitespace-pre-wrap rounded-md border bg-muted p-3 font-mono text-xs [overflow-wrap:anywhere]">
                  {serverPairCommand(code.code)}
                </pre>
              </div>
            </div>
          ) : (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          )}
          <p className="text-sm">
            Host:{' '}
            <span aria-live="polite" className="text-muted-foreground">
              {connectStatus.text}
            </span>
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={!connecting || pairMutation.isPending}
              onClick={() =>
                connecting && pairMutation.mutate(connecting.botId)
              }
            >
              New code
            </Button>
            <Button type="button" onClick={() => setConnecting(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete */}
      <Dialog
        open={!!botToDelete}
        onOpenChange={(open) => {
          if (!open) setBotToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {botToDelete?.username ?? ''}</DialogTitle>
            <DialogDescription>
              The bot leaves the workspace and every connected host stops
              working right away. Its messages stay, under its name. This can't
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setBotToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() =>
                botToDelete && deleteMutation.mutate(botToDelete.id)
              }
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
