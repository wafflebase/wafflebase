import { Loader2 } from "lucide-react";

export const Loader = () => {
  return (
    <div
      className="flex flex-col items-center justify-center min-h-[300px]"
      aria-live="polite"
    >
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
      <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
    </div>
  );
};
