const features = [
  {
    icon: "⚡",
    title: "Real-Time Collaboration",
    description: "CRDT-powered concurrent editing. Multiple users can work on the same sheet without conflicts.",
  },
  {
    icon: "📐",
    title: "Formula Engine",
    description: "Google Sheets-compatible formulas — SUM, VLOOKUP, IF, and more. Cross-sheet references supported.",
  },
  {
    icon: "📊",
    title: "Charts & Pivot Tables",
    description: "Visualize your data with built-in charts and pivot tables. Get insights at a glance.",
  },
  {
    icon: "🔗",
    title: "External Datasources",
    description: "Connect PostgreSQL databases directly. Query live data with the built-in SQL editor.",
  },
  {
    icon: "🔒",
    title: "Sharing & Permissions",
    description: "Share via URL with role-based access control. Collaborate with anyone, securely.",
  },
  {
    icon: "🧇",
    title: "Open Source",
    description: "Apache-2.0 licensed. Self-host, customize, and contribute. Your data, your rules.",
  },
];

export function FeaturesSection() {
  return (
    <section id="features" className="bg-background py-12 md:py-20 px-4 md:px-12">
      <h2 className="text-center text-3xl font-bold text-homepage-text mb-2">
        A Spreadsheet for Every Team
      </h2>
      <p className="text-center text-base text-homepage-text-secondary mb-12">
        An open-source alternative to Google Sheets — free to use, extend, and self-host
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-[960px] mx-auto">
        {features.map((f) => (
          <div key={f.title} className="bg-homepage-bg border border-homepage-accent/30 rounded-xl p-7">
            <div className="text-3xl mb-3">{f.icon}</div>
            <h3 className="text-lg font-semibold text-homepage-text mb-2">{f.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
