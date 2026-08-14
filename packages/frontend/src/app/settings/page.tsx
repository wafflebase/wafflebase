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

/**
 * Renders the application settings page.
 */
export default function Settings() {
  const { theme, setTheme } = useContext(ThemeProviderContext);
  const dateFormat = useDateFormat();

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
    </div>
  );
}
