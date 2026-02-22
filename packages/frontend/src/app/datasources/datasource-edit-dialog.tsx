import { useState, useEffect } from "react";
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
import { updateDataSource, testDataSourceConnection } from "@/api/datasources";
import { isAuthExpiredError } from "@/api/auth";
import type { DataSource } from "@/types/datasource";
import { toast } from "sonner";

type DataSourceEditDialogProps = {
  datasource: DataSource | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

export function DataSourceEditDialog({
  datasource,
  open,
  onOpenChange,
  onSaved,
}: DataSourceEditDialogProps) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [sslEnabled, setSslEnabled] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (datasource) {
      setName(datasource.name);
      setHost(datasource.host);
      setPort(String(datasource.port));
      setDatabase(datasource.database);
      setUsername(datasource.username);
      setPassword("");
      setSslEnabled(datasource.sslEnabled);
    }
  }, [datasource]);

  const handleSave = async () => {
    if (!datasource) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {};
      if (name !== datasource.name) payload.name = name;
      if (host !== datasource.host) payload.host = host;
      if (Number(port) !== datasource.port) payload.port = Number(port);
      if (database !== datasource.database) payload.database = database;
      if (username !== datasource.username) payload.username = username;
      if (password) payload.password = password;
      if (sslEnabled !== datasource.sslEnabled) payload.sslEnabled = sslEnabled;

      await updateDataSource(datasource.id, payload);
      toast.success("DataSource updated");
      onSaved();
    } catch (error) {
      if (isAuthExpiredError(error)) return;
      toast.error("Failed to update datasource");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!datasource) return;
    setTesting(true);
    try {
      const result = await testDataSourceConnection(datasource.id);
      if (result.success) {
        toast.success("Connection successful");
      } else {
        toast.error(`Connection failed: ${result.error}`);
      }
    } catch (error) {
      if (isAuthExpiredError(error)) return;
      toast.error("Failed to test connection");
    } finally {
      setTesting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit DataSource</DialogTitle>
          <DialogDescription>
            Update the connection settings for this datasource.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="edit-ds-name">Name</Label>
            <Input
              id="edit-ds-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2 grid gap-2">
              <Label htmlFor="edit-ds-host">Host</Label>
              <Input
                id="edit-ds-host"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-ds-port">Port</Label>
              <Input
                id="edit-ds-port"
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-ds-database">Database</Label>
            <Input
              id="edit-ds-database"
              value={database}
              onChange={(e) => setDatabase(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-2">
              <Label htmlFor="edit-ds-username">Username</Label>
              <Input
                id="edit-ds-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-ds-password">Password</Label>
              <Input
                id="edit-ds-password"
                type="password"
                placeholder="Leave blank to keep current"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch
              id="edit-ds-ssl"
              checked={sslEnabled}
              onCheckedChange={setSslEnabled}
            />
            <Label htmlFor="edit-ds-ssl">Enable SSL</Label>
          </div>
        </div>
        <div className="flex justify-between">
          <Button variant="outline" onClick={handleTest} disabled={testing}>
            {testing ? "Testing..." : "Test Connection"}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name || !host || !database || !username}
          >
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
