import { usePresences } from "@yorkie-js/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/api/auth";
import { User } from "@/types/users";

interface UserPresenceProps {
  className?: string;
}

export function UserPresence({ className }: UserPresenceProps) {
  const { data: currentUser } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    retry: false,
  });

  const presences = usePresences<User>();

  // Get unique users (including current user from presences)
  const uniqueUsers = presences.reduce(
    (unique: typeof presences, presenceData) => {
      const username = presenceData.presence.username as string;
      if (!unique.find((u) => (u.presence.username as string) === username)) {
        unique.push(presenceData);
      }
      return unique;
    },
    []
  );

  const totalUsers = uniqueUsers.length;

  return (
    <TooltipProvider>
      <div className={`flex items-center gap-2 min-h-[2.5rem] ${className}`}>
        {totalUsers > 0 ? (
          <>
            <div className="flex items-center -space-x-2">
              {uniqueUsers
                .slice(0, 4)
                .map((presenceData) => {
                  const username = presenceData.presence?.username as string;
                  const photo = presenceData.presence?.photo as string;
                  const isCurrentUser = username === currentUser?.username;
                  if (!username) {
                    return null;
                  }

                  return (
                    <Tooltip key={presenceData.clientID}>
                      <TooltipTrigger asChild>
                        <div className="relative">
                          <Avatar className="h-8 w-8 border-2 border-background">
                            {photo && (
                              <AvatarImage src={photo} alt={username} />
                            )}
                            <AvatarFallback className="text-xs">
                              {username?.slice(0, 2).toUpperCase() || "??"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="absolute -bottom-1 -right-1">
                            <div className="h-3 w-3 rounded-full bg-green-500 border-2 border-background" />
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          {username || "Anonymous"}
                          {isCurrentUser ? " (You)" : ""}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  );
                })
                .filter(Boolean)}

              {/* Show +N if there are more than 4 users total */}
              {totalUsers > 4 && (
                <Avatar className="w-8 border-2 border-background">
                  <AvatarFallback className="text-xs bg-muted">
                    +{totalUsers - 4}
                  </AvatarFallback>
                </Avatar>
              )}
            </div>
          </>
        ) : (
          <div className="w-32 opacity-0" />
        )}
      </div>
    </TooltipProvider>
  );
}
