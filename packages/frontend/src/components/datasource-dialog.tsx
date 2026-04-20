import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DataSourceFormFields } from "@/components/datasource-form-fields";
import { testDataSourceConnection } from "@/api/datasources";
import { createWorkspaceDataSource } from "@/api/workspaces";
import { isAuthExpiredError } from "@/api/auth";
import type { DataSource } from "@/types/datasource";
import { toast } from "sonner";

type DataSourceDialogProps = {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (ds: DataSource) => void;
};

/**
 * Renders the DataSourceDialog component.
 */
export function DataSourceDialog({
  workspaceId,
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
      const ds = await createWorkspaceDataSource(workspaceId, {
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
    } catch (error) {
      if (isAuthExpiredError(error)) return;
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
        const ds = await createWorkspaceDataSource(workspaceId, {
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
      } catch (error) {
        if (isAuthExpiredError(error)) return;
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
    } catch (error) {
      if (isAuthExpiredError(error)) return;
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
        <DataSourceFormFields
          idPrefix="ds"
          name={name}
          host={host}
          port={port}
          database={database}
          username={username}
          password={password}
          sslEnabled={sslEnabled}
          onNameChange={setName}
          onHostChange={setHost}
          onPortChange={setPort}
          onDatabaseChange={setDatabase}
          onUsernameChange={setUsername}
          onPasswordChange={setPassword}
          onSslEnabledChange={setSslEnabled}
        />
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
