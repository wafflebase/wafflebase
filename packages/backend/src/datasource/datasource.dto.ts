export class CreateDataSourceDto {
  name: string;
  host: string;
  port?: number;
  database: string;
  username: string;
  password: string;
  sslEnabled?: boolean;
}

export class UpdateDataSourceDto {
  name?: string;
  host?: string;
  port?: number;
  database?: string;
  username?: string;
  password?: string;
  sslEnabled?: boolean;
}

export class ExecuteQueryDto {
  query: string;
}
