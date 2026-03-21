import { useState } from "react";
import { Link } from "react-router-dom";
import { Grid2x2PlusIcon, Menu, X } from "lucide-react";

export function NavBar({ workspacePath }: { workspacePath: string | null }) {
  const [open, setOpen] = useState(false);

  return (
    <nav className="bg-homepage-bg border-b border-homepage-accent/30 px-4 md:px-12 py-4">
      <div className="flex justify-between items-center">
        <Link
          to="/"
          className="flex items-center gap-2 text-xl font-bold text-homepage-text no-underline"
        >
          <Grid2x2PlusIcon className="size-5.5 stroke-homepage-text" />
          Wafflebase
        </Link>
        <div className="flex items-center gap-6">
          {/* Desktop links */}
          <a
            href="#features"
            className="hidden md:inline text-sm text-homepage-text-secondary no-underline hover:text-homepage-text"
          >
            Features
          </a>
          <a
            href="/docs"
            className="hidden md:inline text-sm text-homepage-text-secondary no-underline hover:text-homepage-text"
          >
            Documentation
          </a>
          <a
            href="https://github.com/wafflebase/wafflebase"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden md:inline text-sm text-homepage-text-secondary no-underline hover:text-homepage-text"
          >
            GitHub
          </a>
          <Link
            to={workspacePath ?? "/login"}
            className="hidden md:inline-block bg-homepage-accent text-white px-5 py-2 rounded-md text-sm font-semibold no-underline"
          >
            {workspacePath ? "Go to Workspace" : "Get Started"}
          </Link>
          {/* Mobile hamburger */}
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden p-1 text-homepage-text"
            aria-label="Toggle menu"
            aria-expanded={open}
            aria-controls="mobile-menu"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      {open && (
        <div id="mobile-menu" className="md:hidden mt-4 pb-2 flex flex-col gap-3 border-t border-homepage-accent/20 pt-4">
          <a
            href="#features"
            onClick={() => setOpen(false)}
            className="text-sm text-homepage-text-secondary no-underline hover:text-homepage-text"
          >
            Features
          </a>
          <a
            href="/docs"
            onClick={() => setOpen(false)}
            className="text-sm text-homepage-text-secondary no-underline hover:text-homepage-text"
          >
            Documentation
          </a>
          <a
            href="https://github.com/wafflebase/wafflebase"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className="text-sm text-homepage-text-secondary no-underline hover:text-homepage-text"
          >
            GitHub
          </a>
          <Link
            to={workspacePath ?? "/login"}
            onClick={() => setOpen(false)}
            className="bg-homepage-accent text-white px-5 py-2 rounded-md text-sm font-semibold no-underline text-center"
          >
            {workspacePath ? "Go to Workspace" : "Get Started"}
          </Link>
        </div>
      )}
    </nav>
  );
}
