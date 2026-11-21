import { useChatStream } from "@/components/chat/use-chat-stream";

/**
 * The one chat stream of a signed-in session. Rendered by `PrivateRoute`,
 * which stays mounted across every private route, so moving between the
 * list layout and an editor — each with its own `AppSidebar` — neither
 * reopens the stream nor replays the blanket refetch its `ready` triggers.
 */
export function ChatStreamHost(): null {
  useChatStream(true);
  return null;
}
