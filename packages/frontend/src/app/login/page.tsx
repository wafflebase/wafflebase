import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Grid2x2PlusIcon } from "lucide-react";

import { LoginForm } from "@/components/login-form";
import { Card, CardContent } from "@/components/ui/card";

const GITHUB_URL = "https://github.com/wafflebase/wafflebase";

/**
 * Renders the login page.
 */
export default function LoginPage() {
  useEffect(() => {
    document.title = "Login — Wafflebase";
  }, []);

  return (
    <div className="grid min-h-svh">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link to="/" className="flex items-center gap-2 font-medium">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Grid2x2PlusIcon className="!size-5" />
            </div>
            Wafflebase
          </Link>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="flex w-full max-w-sm flex-col gap-4">
            <Card>
              <CardContent>
                <LoginForm />
              </CardContent>
            </Card>
            <p className="text-center text-xs text-muted-foreground">
              <a
                href={`${GITHUB_URL}/blob/main/LICENSE`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                Apache-2.0
              </a>
              <span className="mx-2 text-muted-foreground/50">·</span>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors"
              >
                GitHub
              </a>
              <span className="mx-2 text-muted-foreground/50">·</span>
              <Link
                to="/docs"
                className="hover:text-foreground transition-colors"
              >
                Docs
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
