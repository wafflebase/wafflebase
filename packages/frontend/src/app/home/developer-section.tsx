const restApiCode = `# Read a cell
curl /api/v1/workspaces/:wid/\\
  documents/:did/tabs/:tid/\\
  cells/A1 \\
  -H "Authorization: Bearer wfb_..."

# Write a cell
curl -X PUT /api/v1/.../cells/B2 \\
  -d '{"value": "Hello"}'

# Batch update
curl -X PATCH /api/v1/.../cells \\
  -d '{"cells": {"A1": {"value": "1"},
    "B1": {"formula": "=A1*2"}}}'`;

const cliCode = `# Authenticate
$ wfb auth login

# List documents
$ wfb document list
[
  {"id": "abc-123",
   "title": "Q1 Report"}
]

# Read / write cells
$ wfb cell get abc-123 Sheet1 A1
$ wfb cell set abc-123 Sheet1 B2 \\
    --value "Hello"

# Export to CSV
$ wfb export abc-123 -o data.csv`;

export function DeveloperSection() {
  return (
    <section id="developers" className="bg-stone-900 py-20 px-12">
      <h2 className="text-center text-3xl font-bold text-amber-300 mb-2">
        Built for Developers
      </h2>
      <p className="text-center text-base text-amber-600 mb-12">
        Automate your spreadsheets with REST API and CLI
      </p>
      <div className="max-w-[900px] mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-stone-800 rounded-xl p-6 overflow-x-auto">
          <div className="text-xs text-stone-400 font-semibold uppercase tracking-wider mb-3">
            REST API
          </div>
          <pre className="text-amber-50 text-sm font-mono leading-7 whitespace-pre">
            {restApiCode}
          </pre>
        </div>
        <div className="bg-stone-800 rounded-xl p-6 overflow-x-auto">
          <div className="text-xs text-stone-400 font-semibold uppercase tracking-wider mb-3">
            CLI
          </div>
          <pre className="text-amber-50 text-sm font-mono leading-7 whitespace-pre">
            {cliCode}
          </pre>
        </div>
      </div>
    </section>
  );
}
