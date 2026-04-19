import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface DataSourceFormFieldsProps {
  idPrefix: string;
  name: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  sslEnabled: boolean;
  passwordPlaceholder?: string;
  onNameChange: (value: string) => void;
  onHostChange: (value: string) => void;
  onPortChange: (value: string) => void;
  onDatabaseChange: (value: string) => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSslEnabledChange: (value: boolean) => void;
}

export function DataSourceFormFields({
  idPrefix,
  name,
  host,
  port,
  database,
  username,
  password,
  sslEnabled,
  passwordPlaceholder,
  onNameChange,
  onHostChange,
  onPortChange,
  onDatabaseChange,
  onUsernameChange,
  onPasswordChange,
  onSslEnabledChange,
}: DataSourceFormFieldsProps) {
  return (
    <div className="grid gap-4 py-2">
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input
          id={`${idPrefix}-name`}
          placeholder="My Database"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2 grid gap-2">
          <Label htmlFor={`${idPrefix}-host`}>Host</Label>
          <Input
            id={`${idPrefix}-host`}
            placeholder="localhost"
            value={host}
            onChange={(e) => onHostChange(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-port`}>Port</Label>
          <Input
            id={`${idPrefix}-port`}
            type="number"
            value={port}
            onChange={(e) => onPortChange(e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-database`}>Database</Label>
        <Input
          id={`${idPrefix}-database`}
          placeholder="mydb"
          value={database}
          onChange={(e) => onDatabaseChange(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-username`}>Username</Label>
          <Input
            id={`${idPrefix}-username`}
            placeholder="postgres"
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${idPrefix}-password`}>Password</Label>
          <Input
            id={`${idPrefix}-password`}
            type="password"
            placeholder={passwordPlaceholder}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id={`${idPrefix}-ssl`}
          checked={sslEnabled}
          onCheckedChange={onSslEnabledChange}
        />
        <Label htmlFor={`${idPrefix}-ssl`}>Enable SSL</Label>
      </div>
    </div>
  );
}
