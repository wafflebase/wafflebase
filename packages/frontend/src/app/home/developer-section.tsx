const API = "/api/v1/workspaces/:wid/documents/:did";

const restApiCode = `# Read cells (with optional range)
curl ${API}/\\
  tabs/:tid/cells?range=A1:C10 \\
  -H "Authorization: Bearer wfb_..."

# Write a cell
curl -X PUT ${API}/\\
  tabs/:tid/cells/B2 \\
  -d '{"value": "Hello"}'

# Set a formula
curl -X PUT ${API}/\\
  tabs/:tid/cells/C1 \\
  -d '{"formula": "=SUM(A1:B1)"}'

# Batch update
curl -X PATCH ${API}/\\
  tabs/:tid/cells \\
  -d '{"cells": {
    "A1": {"value": "Revenue"},
    "B1": {"formula": "=SUM(B2:B10)"},
    "C1": null
  }}'`;

const cliCode = `# List documents
$ wafflebase document list
[
  {"id": "abc-123",
   "title": "Q1 Report"}
]

# Read cells (range or single)
$ wafflebase cell get abc-123 A1:C10
$ wafflebase cell get abc-123 A1

# Write a cell value
$ wafflebase cell set abc-123 A1 "Revenue"

# Write a formula
$ wafflebase cell set abc-123 B2 \\
    "=SUM(A1:A10)" --formula

# Batch update via stdin
$ echo '{"A1":"Name","B1":"Score"}' \\
    | wafflebase cell batch abc-123

# Output as table or CSV
$ wafflebase cell get abc-123 --format table`;

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
