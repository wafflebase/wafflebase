import { useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMe } from "@/api/auth";
import { ThemeProviderContext } from "@/components/theme-provider";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatExactDate,
  formatRelativeTime,
} from "@/app/documents/document-list-utils";
import {
  setDateFormat,
  useDateFormat,
  type DateDisplayFormat,
} from "@/lib/date-format-preference";
import {
  setOfflinePersistenceEnabled,
  useOfflinePersistenceEnabled,
} from "@/lib/offline-persistence-preference";
import { supportsClientKey } from "@/lib/yorkie-capabilities";

/**
 * This device's settings, without a frame around them.
 *
 * Separated from the page below so the same sections render inside the dialog
 * the user menu opens (`components/settings-dialog.tsx`). The dialog is the
 * entry point people actually use — `NavUser` is mounted by every editor shell
 * as well as `Layout`, so it opens over a document instead of navigating away
 * from one, which for a document with unsent edits is the difference between a
 * settings change and the navigation guard's "leave without saving?".
 *
 * Everything here is scoped to this device — the offline switch to this
 * account *on* it — rather than to the workspace, which is why it is not the
 * workspace's Settings page and must not read as it.
 */
export function SettingsContent() {
  const { theme, setTheme } = useContext(ThemeProviderContext);
  const dateFormat = useDateFormat();
  // The signed-in account, off the cache the authenticated shell already
  // filled: offline saving is consented to per account *on this device*, so
  // this switch shows and writes this user's answer rather than the machine's.
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false });
  const userId = me?.id === undefined ? undefined : String(me.id);
  const offlineEnabled = useOfflinePersistenceEnabled(userId);
  // Read once per render, not stored: it is a build-time fact about the pinned
  // `@yorkie-js/react`, not a preference.
  const offlineAvailable = supportsClientKey();

  const handleThemeToggle = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  // Shown as the option's example so the choice is concrete: a week-old date
  // reads relatively as "7 days ago" and exactly as a same-year "Jul 25".
  const sample = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <div className="flex items-center justify-between rounded-md border p-4">
          <div>
            <label htmlFor="theme-switch" className="text-sm font-medium">
              Dark mode
            </label>
            <p className="text-xs text-muted-foreground">
              Toggle between light and dark themes.
            </p>
          </div>
          <Switch
            id="theme-switch"
            checked={theme === "dark"}
            onCheckedChange={handleThemeToggle}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Dates</h2>
        <div className="flex items-center justify-between gap-4 rounded-md border p-4">
          <div>
            <label htmlFor="date-format" className="text-sm font-medium">
              Date display format
            </label>
            <p className="text-xs text-muted-foreground">
              How the Modified and Created columns are shown in document lists.
              Hovering a date always reveals the full date and time.
            </p>
          </div>
          <Select
            value={dateFormat}
            onValueChange={(value) => setDateFormat(value as DateDisplayFormat)}
          >
            <SelectTrigger id="date-format" className="w-[220px] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="relative">
                Relative ({formatRelativeTime(sample)})
              </SelectItem>
              <SelectItem value="exact">
                Exact date ({formatExactDate(sample)})
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* Per device, deliberately, and the copy says so: persisting writes
          document content to whatever machine the user is on, where it
          outlives the session. An account-level setting would follow them onto
          a shared machine and re-enable there, which is the case this toggle
          exists to prevent (docs/design/offline-local-persistence.md).

          Per *account* as well, which is the same argument pointed the other
          way: a device-wide answer would have one user's consent start writing
          the next user's documents to that machine's disk, with this switch
          showing "on" for a choice they never made. So it is stored per device
          and asked per account.

          Offered only on a build that can honour it. `supportsClientKey()` is
          a hard precondition — without a client key the store fills with
          entries no reload can use — and every other consumer is already
          behind it. A switch is not: it would promise storage and erasure that
          this build cannot perform, which is what the design's Rollout section
          means by "the preference may land early because nothing reads it; the
          toggle may not". Bumping `@yorkie-js/react` past
          `MinClientKeyVersion` is the one action that reveals it. */}
      {offlineAvailable && (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Offline</h2>
        <div className="flex items-center justify-between gap-4 rounded-md border p-4">
          <div>
            <label htmlFor="offline-switch" className="text-sm font-medium">
              Save documents on this device
            </label>
            <p className="text-xs text-muted-foreground">
              Keeps edits that have not reached the server on this device, so
              they survive a reload or a crash while you are offline. Applies to
              this device and this account only, and turning it off deletes what
              was stored.
            </p>
          </div>
          <Switch
            id="offline-switch"
            checked={offlineEnabled}
            // Disabled until the identity resolves: the choice is recorded
            // against an account, and one made with nobody signed in would be
            // written nowhere while the switch showed it as on.
            disabled={!userId}
            onCheckedChange={(enabled) => {
              if (!userId) return;
              setOfflinePersistenceEnabled(userId, enabled);
            }}
          />
        </div>
      </section>
      )}
    </div>
  );
}

/**
 * The same settings as a route, kept for links people already hold.
 *
 * No sidebar entry points here any more — `use-workspace-nav-items` used to
 * carry one, and because its target flipped on whether a workspace slug had
 * resolved, it meant the *workspace's* settings for everybody who had a
 * workspace, which is everybody.
 */
export default function Settings() {
  return (
    <div className="p-4 lg:p-6 max-w-2xl">
      <SettingsContent />
    </div>
  );
}
