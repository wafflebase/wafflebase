import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  createDataSource,
  testDataSourceConnection,
} from "@/api/datasources";
import type { DataSource } from "@/types/datasource";
import { toast } from "sonner";

type DataSourceDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (ds: DataSource) => void;
};

export function DataSourceDialog({
  open,
  onOpenChange,
  onCreated,
}: DataSourceDialogProps) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sslEnabled, setSslEnabled] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setHost("localhost");
    setPort("5432");
    setDatabase("");
    setUsername("");
    setPassword("");
    setSslEnabled(false);
    setSavedId(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const ds = await createDataSource({
        name,
        host,
        port: Number(port),
        database,
        username,
        password,
        sslEnabled,
      });
      setSavedId(ds.id);
      toast.success("DataSource created");
      onCreated(ds);
      resetForm();
      onOpenChange(false);
    } catch {
      toast.error("Failed to create datasource");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!savedId) {
      // Save first, then test
      setSaving(true);
      try {
        const ds = await createDataSource({
          name: name || "Untitled",
          host,
          port: Number(port),
          database,
          username,
          password,
          sslEnabled,
        });
        setSavedId(ds.id);

        setTesting(true);
        const result = await testDataSourceConnection(ds.id);
        if (result.success) {
          toast.success("Connection successful");
        } else {
          toast.error(`Connection failed: ${result.error}`);
        }
      } catch {
        toast.error("Failed to test connection");
      } finally {
        setSaving(false);
        setTesting(false);
      }
      return;
    }

    setTesting(true);
    try {
      const result = await testDataSourceConnection(savedId);
      if (result.success) {
        toast.success("Connection successful");
      } else {
        toast.error(`Connection failed: ${result.error}`);
      }
    } catch {
      toast.error("Failed to test connection");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New DataSource Connection</DialogTitle>
          <DialogDescription>
            Connect to an external PostgreSQL database.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="ds-name">Name</Label>
            <Input
              id="ds-name"
              placeholder="My Database"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 grid gap-2">
              <Label htmlFor="ds-host">Host</Label>
              <Input
                id="ds-host"
                placeholder="localhost"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ds-port">Port</Label>
              <Input
                id="ds-port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ds-database">Database</Label>
            <Input
              id="ds-database"
              placeholder="mydb"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label htmlFor="ds-username">Username</Label>
              <Input
                id="ds-username"
                placeholder="postgres"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ds-password">Password</Label>
              <Input
                id="ds-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="ds-ssl"
              checked={sslEnabled}
              onCheckedChange={setSslEnabled}
            />
            <Label htmlFor="ds-ssl">Enable SSL</Label>
          </div>
        </div>
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={handleTest}
            disabled={testing || !host || !database}
          >
            {testing ? "Testing..." : "Test Connection"}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name || !host || !database || !username}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
