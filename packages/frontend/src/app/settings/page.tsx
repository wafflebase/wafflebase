import { useContext } from "react";
import { ThemeProviderContext } from "@/components/theme-provider";
import { Switch } from "@/components/ui/switch";

/**
 * Renders the application settings page.
 */
export default function Settings() {
  const { theme, setTheme } = useContext(ThemeProviderContext);

  const handleThemeToggle = () => {
    setTheme(theme === "dark" ? "light" : "dark");
  };

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
    </div>
  );
}
