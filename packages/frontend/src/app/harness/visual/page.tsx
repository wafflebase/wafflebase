import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const documents = [
  {
    id: "doc-001",
    title: "Q1 Revenue Plan",
    owner: "alice",
    updatedAt: "2026-02-20 09:31",
    status: "stable",
  },
  {
    id: "doc-002",
    title: "Supply Chain Tracker",
    owner: "bruno",
    updatedAt: "2026-02-21 14:04",
    status: "review",
  },
  {
    id: "doc-003",
    title: "Retention Experiments",
    owner: "chloe",
    updatedAt: "2026-02-22 18:12",
    status: "stable",
  },
];

function statusBadgeVariant(status: string): "default" | "secondary" {
  return status === "stable" ? "default" : "secondary";
}

export default function VisualHarnessPage() {
  return (
    <main className="min-h-screen bg-muted/20 p-6 md:p-10" data-testid="visual-harness-root">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Wafflebase Harness</p>
              <h1 className="text-2xl font-semibold tracking-tight">
                Frontend Visual Regression Baseline
              </h1>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline">Export</Button>
              <Button>Create Document</Button>
            </div>
          </div>
        </header>

        <Tabs className="gap-4" defaultValue="documents">
          <TabsList>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="documents">
            <Card>
              <CardHeader>
                <CardTitle>Document Overview</CardTitle>
                <CardDescription>
                  Stable sample data used to detect visual regressions.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Owner</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {documents.map((doc) => (
                      <TableRow key={doc.id}>
                        <TableCell className="font-medium">{doc.title}</TableCell>
                        <TableCell>{doc.owner}</TableCell>
                        <TableCell>{doc.updatedAt}</TableCell>
                        <TableCell>
                          <Badge variant={statusBadgeVariant(doc.status)}>
                            {doc.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle>Workspace Preferences</CardTitle>
                <CardDescription>
                  Input controls are included for style and spacing coverage.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="workspace-name">Workspace Name</Label>
                  <Input defaultValue="Wafflebase Team" id="workspace-name" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="timezone">Time Zone</Label>
                  <Input defaultValue="UTC+09:00 (Asia/Seoul)" id="timezone" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="currency">Default Currency</Label>
                  <Input defaultValue="USD" id="currency" />
                </div>
                <div className="flex items-end gap-2">
                  <Button variant="outline">Discard</Button>
                  <Button>Save Changes</Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
