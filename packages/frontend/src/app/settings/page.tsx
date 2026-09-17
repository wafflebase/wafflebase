import { useContext } from "react";
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

/**
 * Renders the application settings page.
 */
export default function Settings() {
  const { theme, setTheme } = useContext(ThemeProviderContext);
  const dateFormat = useDateFormat();
  const offlineEnabled = useOfflinePersistenceEnabled();

  const handleThemeToggle = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

  // Shown as the option's example so the choice is concrete: a week-old date
  // reads relatively as "7 days ago" and exactly as a same-year "Jul 25".
  const sample = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  return (
    <div className="p-4 lg:p-6 max-w-2xl space-y-8">
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
          exists to prevent (docs/design/offline-local-persistence.md). */}
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
              this device only, and turning it off deletes what was stored.
            </p>
          </div>
          <Switch
            id="offline-switch"
            checked={offlineEnabled}
            onCheckedChange={setOfflinePersistenceEnabled}
          />
        </div>
      </section>
    </div>
  );
}
