/*
 * A route file, for the layout half of the gate.
 *
 * The shape matters more than the content: a static subtree the structural ops may
 * touch, and a `.map()` body they may not — `extract.mjs` scopes the second as
 * `iteration`, so a `layout-remove` there must be refused rather than written.
 */
import { Badge } from '../components/badge';

const ROWS = [
  { id: 'a', label: 'Revenue' },
  { id: 'b', label: 'Signups' },
];

export default function Dashboard() {
  return (
    <main className="p-6 bg-background text-foreground">
      <header className="mb-4 flex items-center gap-2">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <Badge className="bg-primary">live</Badge>
      </header>
      <p className="text-muted-foreground">Nothing here is wafflebase.</p>
      <ul className="mt-4 space-y-2">
        {ROWS.map((row) => (
          <li key={row.id} className="rounded-md border border-border p-2">
            {row.label}
          </li>
        ))}
      </ul>
    </main>
  );
}
