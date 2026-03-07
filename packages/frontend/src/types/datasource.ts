export type DataSource = {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password: string; // Always masked from API
  sslEnabled: boolean;
  authorID: number;
  createdAt: string;
  updatedAt: string;
};

export type QueryColumn = {
  name: string;
  dataTypeID: number;
};

export type QueryResult = {
  columns: QueryColumn[];
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  executionTime: number;
};

export type TestConnectionResult = {
  success: boolean;
  error?: string;
};
