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
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center justify-between p-4">
        <div>
          <label htmlFor="theme-switch" className="text-sm font-medium">
            Theme
          </label>
          <p className="text-xs text-gray-500">
            Toggle between light and dark themes.
          </p>
        </div>
        <div className="ml-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="theme-switch"
              checked={theme === "dark"}
              onCheckedChange={handleThemeToggle}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
