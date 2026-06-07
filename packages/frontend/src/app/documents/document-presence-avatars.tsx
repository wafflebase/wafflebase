import { MouseEvent } from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AvatarStack, AvatarStackUser } from "@/components/avatar-stack";
import type { DocumentEditor } from "@/types/documents";

function toStackUsers(editors: DocumentEditor[]): AvatarStackUser[] {
  return editors.map((editor) => ({
    key: editor.email || editor.username,
    username: editor.username,
    photo: editor.photo,
  }));
}

/**
 * Compact avatar stack shown in the documents-list row to indicate who is
 * currently editing. Stops click propagation so users can hover/click the
 * avatars without navigating into the document.
 */
export function DocumentPresenceAvatars({
  editors,
}: {
  editors?: DocumentEditor[];
}) {
  if (!editors || editors.length === 0) return null;

  return (
    <div
      onClick={(e: MouseEvent<HTMLElement>) => e.stopPropagation()}
      className="inline-flex"
    >
      <AvatarStack
        users={toStackUsers(editors)}
        size={24}
        maxVisible={3}
        renderAvatar={(user, avatar) => (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">{avatar}</span>
            </TooltipTrigger>
            <TooltipContent>{user.username}</TooltipContent>
          </Tooltip>
        )}
      />
    </div>
  );
}
