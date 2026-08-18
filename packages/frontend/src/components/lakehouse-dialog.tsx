import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  createWorkspaceLakehouseSource,
  testLakehouseSource,
  testWorkspaceLakehouseSource,
  updateLakehouseSource,
} from '@/api/lakehouse';
import { isAuthExpiredError } from '@/api/auth';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getLakehouseBucketError,
  getLakehouseCredentialsError,
  getLakehouseEndpointError,
  getLakehouseSourcePathError,
} from '@/types/lakehouse';
import type {
  CreateLakehouseSourceInput,
  LakehouseCredentials,
  LakehouseFormat,
  LakehouseSource,
  LakehouseStorage,
  UpdateLakehouseSourceInput,
} from '@/types/lakehouse';

const DEFAULT_S3_COMPATIBLE_ENDPOINT = 'http://localhost:9000';

type LakehouseDialogProps = {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (source: LakehouseSource) => void;
  source?: LakehouseSource | null;
};

type FormState = {
  name: string;
  format: LakehouseFormat;
  storage: LakehouseStorage;
  endpoint: string;
  region: string;
  bucket: string;
  basePath: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  accountName: string;
  accountKey: string;
  connectionString: string;
  sasToken: string;
};

const EMPTY_FORM: FormState = {
  name: '',
  format: 'iceberg',
  storage: 's3-compatible',
  endpoint: DEFAULT_S3_COMPATIBLE_ENDPOINT,
  region: 'us-east-1',
  bucket: '',
  basePath: '',
  accessKeyId: '',
  secretAccessKey: '',
  sessionToken: '',
  accountName: '',
  accountKey: '',
  connectionString: '',
  sasToken: '',
};

function formFromSource(source?: LakehouseSource | null): FormState {
  if (!source) return { ...EMPTY_FORM };
  return {
    ...EMPTY_FORM,
    name: source.name,
    format: source.format,
    storage: source.storage,
    endpoint: source.endpoint ?? '',
    region: source.region ?? '',
    bucket: source.bucket ?? '',
    basePath: source.basePath,
  };
}

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function credentialsFromForm(form: FormState): LakehouseCredentials {
  if (form.storage === 'local') return {};

  const credentials: LakehouseCredentials = {};
  if (form.storage === 'azure') {
    const accountName = nonEmpty(form.accountName);
    const accountKey = nonEmpty(form.accountKey);
    const connectionString = nonEmpty(form.connectionString);
    const sasToken = nonEmpty(form.sasToken);
    if (accountName) credentials.accountName = accountName;
    if (accountKey) credentials.accountKey = accountKey;
    if (connectionString) credentials.connectionString = connectionString;
    if (sasToken) credentials.sasToken = sasToken;
    return credentials;
  }

  const accessKeyId = nonEmpty(form.accessKeyId);
  const secretAccessKey = nonEmpty(form.secretAccessKey);
  const sessionToken = nonEmpty(form.sessionToken);
  if (accessKeyId) credentials.accessKeyId = accessKeyId;
  if (secretAccessKey) credentials.secretAccessKey = secretAccessKey;
  if (
    sessionToken &&
    (form.storage === 's3' || form.storage === 's3-compatible')
  ) {
    credentials.sessionToken = sessionToken;
  }
  return credentials;
}

function createPayload(form: FormState): CreateLakehouseSourceInput {
  return {
    name: form.name.trim(),
    format: form.format,
    storage: form.storage,
    endpoint:
      form.storage === 's3-compatible' || form.storage === 'azure'
        ? nonEmpty(form.endpoint)
        : undefined,
    region:
      form.storage === 's3' || form.storage === 's3-compatible'
        ? nonEmpty(form.region)
        : undefined,
    bucket: form.storage === 'local' ? undefined : nonEmpty(form.bucket),
    basePath: form.basePath.trim(),
    credentials: credentialsFromForm(form),
  };
}

function canMergeSourceCredentials(
  source: LakehouseSource | null | undefined,
  form: FormState,
): boolean {
  if (!source || source.storage !== form.storage) return false;
  const normalize = (value: string | null | undefined) =>
    value?.trim().replace(/\/$/, '') ?? '';
  return (
    normalize(source.endpoint) === normalize(form.endpoint) &&
    normalize(source.bucket) === normalize(form.bucket) &&
    normalize(source.basePath) === normalize(form.basePath)
  );
}

function updatePayload(
  form: FormState,
  existingSource: LakehouseSource,
): UpdateLakehouseSourceInput {
  const create = createPayload(form);
  const payload: UpdateLakehouseSourceInput = {
    ...create,
    endpoint: create.endpoint ?? null,
    region: create.region ?? null,
    bucket: create.bucket ?? null,
  };
  if (
    canMergeSourceCredentials(existingSource, form) &&
    Object.keys(payload.credentials ?? {}).length === 0
  ) {
    delete payload.credentials;
  }
  return payload;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Creates, edits, and non-destructively tests a lakehouse connection. */
export function LakehouseDialog({
  workspaceId,
  open,
  onOpenChange,
  onCreated,
  source,
}: LakehouseDialogProps) {
  const [form, setForm] = useState<FormState>(() => formFromSource(source));
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const operationSequenceRef = useRef(0);

  useEffect(() => {
    operationSequenceRef.current += 1;
    if (!open) return;
    setForm(formFromSource(source));
    setTesting(false);
    setSaving(false);
  }, [open, source, workspaceId]);

  useEffect(
    () => () => {
      operationSequenceRef.current += 1;
    },
    [],
  );

  const setField = <K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const setStorage = (storage: LakehouseStorage) => {
    setForm((current) => {
      if (current.storage === storage) return current;
      return {
        ...current,
        storage,
        endpoint:
          storage === 's3-compatible' ? DEFAULT_S3_COMPATIBLE_ENDPOINT : '',
        region:
          storage === 's3' || storage === 's3-compatible'
            ? current.region.trim() || 'us-east-1'
            : '',
        bucket: '',
        accessKeyId: '',
        secretAccessKey: '',
        sessionToken: '',
        accountName: '',
        accountKey: '',
        connectionString: '',
        sasToken: '',
      };
    });
  };

  const bucketError =
    form.storage === 'local' ? undefined : getLakehouseBucketError(form.bucket);
  const basePathError = getLakehouseSourcePathError(form);
  const endpointError = getLakehouseEndpointError(form.storage, form.endpoint);
  const canMergeStoredCredentials = canMergeSourceCredentials(source, form);
  const credentialsError = getLakehouseCredentialsError(
    form.storage,
    credentialsFromForm(form),
    canMergeStoredCredentials,
  );
  const canSubmit = Boolean(
    form.name.trim() &&
      form.basePath.trim() &&
      !bucketError &&
      !basePathError &&
      !endpointError &&
      !credentialsError,
  );
  const usesObjectStorage = form.storage !== 'local';
  const usesS3Credentials =
    form.storage === 's3' ||
    form.storage === 's3-compatible' ||
    form.storage === 'gcs';
  const usesRegion = form.storage === 's3' || form.storage === 's3-compatible';

  const reset = () => {
    setForm(formFromSource(source));
  };

  const persist = async (): Promise<LakehouseSource> => {
    const saved = source
      ? await updateLakehouseSource(source.id, updatePayload(form, source))
      : await createWorkspaceLakehouseSource(workspaceId, createPayload(form));
    return saved;
  };

  const handleSave = async () => {
    if (!canSubmit || saving || testing) return;

    const operation = ++operationSequenceRef.current;
    setSaving(true);
    try {
      const saved = await persist();
      if (operationSequenceRef.current !== operation) return;
      toast.success(
        source
          ? 'Lakehouse connection updated'
          : 'Lakehouse connection created',
      );
      onCreated(saved);
      reset();
      onOpenChange(false);
    } catch (error) {
      if (operationSequenceRef.current !== operation) return;
      if (isAuthExpiredError(error)) return;
      toast.error(errorMessage(error, 'Failed to save lakehouse connection'));
    } finally {
      if (operationSequenceRef.current === operation) {
        setSaving(false);
      }
    }
  };

  const handleTest = async () => {
    if (!canSubmit || saving || testing) return;

    const operation = ++operationSequenceRef.current;
    setTesting(true);
    try {
      const result = source
        ? await testLakehouseSource(source.id, updatePayload(form, source))
        : await testWorkspaceLakehouseSource(workspaceId, createPayload(form));
      if (operationSequenceRef.current !== operation) return;
      if (result.success) {
        toast.success('Connection successful');
      } else {
        toast.error(result.error || 'Connection failed');
      }
    } catch (error) {
      if (operationSequenceRef.current !== operation) return;
      if (isAuthExpiredError(error)) return;
      toast.error(errorMessage(error, 'Failed to test lakehouse connection'));
    } finally {
      if (operationSequenceRef.current === operation) {
        setTesting(false);
      }
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          operationSequenceRef.current += 1;
          reset();
          setTesting(false);
          setSaving(false);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {source ? 'Edit Lakehouse Connection' : 'New Lakehouse Connection'}
          </DialogTitle>
          <DialogDescription>
            Connect directly to an Iceberg metadata file or Delta table root.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="lakehouse-name">Name</Label>
            <Input
              id="lakehouse-name"
              value={form.name}
              placeholder="Analytics Lakehouse"
              onChange={(event) => setField('name', event.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="lakehouse-format">Table format</Label>
              <Select
                value={form.format}
                onValueChange={(value) =>
                  setField('format', value as LakehouseFormat)
                }
              >
                <SelectTrigger id="lakehouse-format" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="iceberg">Apache Iceberg</SelectItem>
                  <SelectItem value="delta">Delta Lake</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="lakehouse-storage">Storage</Label>
              <Select
                value={form.storage}
                onValueChange={(value) => setStorage(value as LakehouseStorage)}
              >
                <SelectTrigger id="lakehouse-storage" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">
                    Local filesystem (server-configured)
                  </SelectItem>
                  <SelectItem value="s3">Amazon S3</SelectItem>
                  <SelectItem value="s3-compatible">S3-compatible</SelectItem>
                  <SelectItem value="gcs">Google Cloud Storage</SelectItem>
                  <SelectItem value="azure">Azure Blob / ADLS</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {usesObjectStorage ? (
            <>
              <div
                className={usesRegion ? 'grid grid-cols-2 gap-3' : 'grid gap-2'}
              >
                <div className="grid gap-2">
                  <Label htmlFor="lakehouse-bucket">
                    {form.storage === 'azure' ? 'Container' : 'Bucket'}
                  </Label>
                  <Input
                    id="lakehouse-bucket"
                    value={form.bucket}
                    aria-invalid={bucketError ? true : undefined}
                    aria-describedby={
                      bucketError ? 'lakehouse-bucket-error' : undefined
                    }
                    onChange={(event) => setField('bucket', event.target.value)}
                  />
                  {bucketError ? (
                    <p
                      id="lakehouse-bucket-error"
                      role="alert"
                      className="text-xs text-destructive"
                    >
                      {bucketError}
                    </p>
                  ) : null}
                </div>
                {usesRegion ? (
                  <div className="grid gap-2">
                    <Label htmlFor="lakehouse-region">Region</Label>
                    <Input
                      id="lakehouse-region"
                      value={form.region}
                      placeholder="us-east-1"
                      onChange={(event) =>
                        setField('region', event.target.value)
                      }
                    />
                  </div>
                ) : null}
              </div>
              {form.storage === 's3-compatible' || form.storage === 'azure' ? (
                <div className="grid gap-2">
                  <Label htmlFor="lakehouse-endpoint">
                    {form.storage === 'azure'
                      ? 'Custom endpoint (optional)'
                      : 'Endpoint'}
                  </Label>
                  <Input
                    id="lakehouse-endpoint"
                    value={form.endpoint}
                    aria-invalid={endpointError ? true : undefined}
                    aria-describedby={
                      endpointError ? 'lakehouse-endpoint-error' : undefined
                    }
                    placeholder={
                      form.storage === 's3-compatible'
                        ? DEFAULT_S3_COMPATIBLE_ENDPOINT
                        : 'http://localhost:10000/account'
                    }
                    onChange={(event) =>
                      setField('endpoint', event.target.value)
                    }
                  />
                  {endpointError ? (
                    <p
                      id="lakehouse-endpoint-error"
                      role="alert"
                      className="text-xs text-destructive"
                    >
                      {endpointError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              Local paths must be enabled and scoped by the Wafflebase server.
            </p>
          )}

          <div className="grid gap-2">
            <Label htmlFor="lakehouse-base-path">
              {form.format === 'iceberg'
                ? 'Iceberg metadata file (.metadata.json)'
                : 'Delta table root'}
            </Label>
            <Input
              id="lakehouse-base-path"
              value={form.basePath}
              aria-invalid={basePathError ? true : undefined}
              aria-describedby={
                basePathError ? 'lakehouse-base-path-error' : undefined
              }
              placeholder={
                form.format === 'iceberg'
                  ? form.storage === 'local'
                    ? '/data/orders/metadata/v3.metadata.json'
                    : 'orders/metadata/v3.metadata.json'
                  : form.storage === 'local'
                    ? '/data/orders'
                    : 'orders'
              }
              onChange={(event) => setField('basePath', event.target.value)}
            />
            {basePathError ? (
              <p
                id="lakehouse-base-path-error"
                role="alert"
                className="text-xs text-destructive"
              >
                {basePathError}
              </p>
            ) : null}
          </div>

          {usesS3Credentials ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="lakehouse-access-key">Access key</Label>
                  <Input
                    id="lakehouse-access-key"
                    autoComplete="off"
                    value={form.accessKeyId}
                    aria-invalid={credentialsError ? true : undefined}
                    aria-describedby={
                      credentialsError
                        ? 'lakehouse-credentials-error'
                        : undefined
                    }
                    placeholder={
                      canMergeStoredCredentials
                        ? 'Leave blank to keep existing'
                        : ''
                    }
                    onChange={(event) =>
                      setField('accessKeyId', event.target.value)
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="lakehouse-secret-key">Secret key</Label>
                  <Input
                    id="lakehouse-secret-key"
                    type="password"
                    autoComplete="new-password"
                    value={form.secretAccessKey}
                    aria-invalid={credentialsError ? true : undefined}
                    aria-describedby={
                      credentialsError
                        ? 'lakehouse-credentials-error'
                        : undefined
                    }
                    placeholder={
                      canMergeStoredCredentials
                        ? 'Leave blank to keep existing'
                        : ''
                    }
                    onChange={(event) =>
                      setField('secretAccessKey', event.target.value)
                    }
                  />
                </div>
              </div>
              {form.storage === 's3' || form.storage === 's3-compatible' ? (
                <div className="grid gap-2">
                  <Label htmlFor="lakehouse-session-token">
                    Session token (optional)
                  </Label>
                  <Input
                    id="lakehouse-session-token"
                    type="password"
                    autoComplete="new-password"
                    value={form.sessionToken}
                    placeholder={
                      canMergeStoredCredentials
                        ? 'Leave blank to keep existing'
                        : ''
                    }
                    onChange={(event) =>
                      setField('sessionToken', event.target.value)
                    }
                  />
                </div>
              ) : null}
            </>
          ) : null}

          {form.storage === 'azure' ? (
            <div className="grid gap-3 rounded-md border p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="lakehouse-account-name">Account name</Label>
                  <Input
                    id="lakehouse-account-name"
                    value={form.accountName}
                    aria-invalid={credentialsError ? true : undefined}
                    aria-describedby={
                      credentialsError
                        ? 'lakehouse-credentials-error'
                        : undefined
                    }
                    placeholder={
                      canMergeStoredCredentials
                        ? 'Leave blank to keep existing'
                        : ''
                    }
                    onChange={(event) =>
                      setField('accountName', event.target.value)
                    }
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="lakehouse-account-key">Account key</Label>
                  <Input
                    id="lakehouse-account-key"
                    type="password"
                    autoComplete="new-password"
                    value={form.accountKey}
                    aria-invalid={credentialsError ? true : undefined}
                    aria-describedby={
                      credentialsError
                        ? 'lakehouse-credentials-error'
                        : undefined
                    }
                    placeholder={
                      canMergeStoredCredentials
                        ? 'Leave blank to keep existing'
                        : ''
                    }
                    onChange={(event) =>
                      setField('accountKey', event.target.value)
                    }
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="lakehouse-connection-string">
                  Connection string (optional)
                </Label>
                <Input
                  id="lakehouse-connection-string"
                  type="password"
                  autoComplete="new-password"
                  value={form.connectionString}
                  aria-invalid={credentialsError ? true : undefined}
                  aria-describedby={
                    credentialsError ? 'lakehouse-credentials-error' : undefined
                  }
                  placeholder={
                    canMergeStoredCredentials
                      ? 'Leave blank to keep existing'
                      : ''
                  }
                  onChange={(event) =>
                    setField('connectionString', event.target.value)
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="lakehouse-sas-token">
                  SAS token (optional)
                </Label>
                <Input
                  id="lakehouse-sas-token"
                  type="password"
                  autoComplete="new-password"
                  value={form.sasToken}
                  aria-invalid={credentialsError ? true : undefined}
                  aria-describedby={
                    credentialsError ? 'lakehouse-credentials-error' : undefined
                  }
                  placeholder={
                    canMergeStoredCredentials
                      ? 'Leave blank to keep existing'
                      : ''
                  }
                  onChange={(event) => setField('sasToken', event.target.value)}
                />
              </div>
            </div>
          ) : null}

          {credentialsError ? (
            <p
              id="lakehouse-credentials-error"
              role="alert"
              className="text-xs text-destructive"
            >
              {credentialsError}
            </p>
          ) : null}

          <div className="flex justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={!canSubmit || testing || saving}
              onClick={() => void handleTest()}
            >
              {testing ? 'Testing...' : 'Test Connection'}
            </Button>
            <Button type="submit" disabled={!canSubmit || testing || saving}>
              {saving ? 'Saving...' : source ? 'Save Changes' : 'Save'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
