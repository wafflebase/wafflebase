import { Link } from "react-router-dom";
import { Grid2x2PlusIcon } from "lucide-react";

export function NavBar() {
  return (
    <nav className="bg-homepage-bg border-b border-homepage-accent/30 px-12 py-4 flex justify-between items-center">
      <Link to="/" className="flex items-center gap-2 text-xl font-bold text-homepage-text no-underline">
        <Grid2x2PlusIcon className="size-5.5 stroke-homepage-text" />
        Wafflebase
      </Link>
      <div className="flex items-center gap-6">
        <a href="#features" className="text-sm text-homepage-text-secondary no-underline">Features</a>
        <a href="#developers" className="text-sm text-homepage-text-secondary no-underline">Developers</a>
        <Link to="/login" className="bg-homepage-accent text-white px-5 py-2 rounded-md text-sm font-semibold no-underline">
          Get Started
        </Link>
      </div>
    </nav>
  );
}
