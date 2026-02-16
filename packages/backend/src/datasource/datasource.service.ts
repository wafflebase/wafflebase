import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Client } from 'pg';
import { PrismaService } from 'src/database/prisma.service';
import { encrypt, decrypt } from './crypto.util';
import { validateSelectQuery } from './sql-validator';
import {
  CreateDataSourceDto,
  UpdateDataSourceDto,
  ExecuteQueryDto,
} from './datasource.dto';

const QUERY_TIMEOUT_MS = 30_000;
const MAX_ROWS = 10_000;

@Injectable()
export class DataSourceService {
  constructor(private prisma: PrismaService) {}

  async create(userId: number, dto: CreateDataSourceDto) {
    return this.prisma.dataSource.create({
      data: {
        name: dto.name,
        host: dto.host,
        port: dto.port ?? 5432,
        database: dto.database,
        username: dto.username,
        password: encrypt(dto.password),
        sslEnabled: dto.sslEnabled ?? false,
        authorID: userId,
      },
    });
  }

  async findAll(userId: number) {
    const datasources = await this.prisma.dataSource.findMany({
      where: { authorID: userId },
      orderBy: { createdAt: 'desc' },
    });

    // Mask passwords
    return datasources.map((ds) => ({
      ...ds,
      password: '********',
    }));
  }

  async findOne(userId: number, id: string) {
    const ds = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!ds) {
      throw new NotFoundException('DataSource not found');
    }
    if (ds.authorID !== userId) {
      throw new ForbiddenException('You do not have access to this datasource');
    }
    return { ...ds, password: '********' };
  }

  async update(userId: number, id: string, dto: UpdateDataSourceDto) {
    const ds = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!ds) {
      throw new NotFoundException('DataSource not found');
    }
    if (ds.authorID !== userId) {
      throw new ForbiddenException('You do not have access to this datasource');
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.host !== undefined) data.host = dto.host;
    if (dto.port !== undefined) data.port = dto.port;
    if (dto.database !== undefined) data.database = dto.database;
    if (dto.username !== undefined) data.username = dto.username;
    if (dto.password !== undefined) data.password = encrypt(dto.password);
    if (dto.sslEnabled !== undefined) data.sslEnabled = dto.sslEnabled;

    return this.prisma.dataSource.update({
      where: { id },
      data,
    });
  }

  async remove(userId: number, id: string) {
    const ds = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!ds) {
      throw new NotFoundException('DataSource not found');
    }
    if (ds.authorID !== userId) {
      throw new ForbiddenException('You do not have access to this datasource');
    }
    return this.prisma.dataSource.delete({ where: { id } });
  }

  async testConnection(userId: number, id: string) {
    const ds = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!ds) {
      throw new NotFoundException('DataSource not found');
    }
    if (ds.authorID !== userId) {
      throw new ForbiddenException('You do not have access to this datasource');
    }

    const client = this.createClient(ds);
    try {
      await client.connect();
      await client.query('SELECT 1');
      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    } finally {
      await client.end().catch(() => {});
    }
  }

  async executeQuery(userId: number, id: string, dto: ExecuteQueryDto) {
    const validation = validateSelectQuery(dto.query);
    if (!validation.valid) {
      throw new BadRequestException(validation.error);
    }

    const ds = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!ds) {
      throw new NotFoundException('DataSource not found');
    }
    if (ds.authorID !== userId) {
      throw new ForbiddenException('You do not have access to this datasource');
    }

    const client = this.createClient(ds);
    try {
      await client.connect();

      // Set statement timeout
      await client.query(
        `SET statement_timeout = '${QUERY_TIMEOUT_MS}'`,
      );

      // Wrap with LIMIT to enforce max rows
      const wrappedQuery = `SELECT * FROM (${dto.query}) AS _q LIMIT ${MAX_ROWS + 1}`;
      const startTime = Date.now();
      const result = await client.query(wrappedQuery);
      const executionTime = Date.now() - startTime;

      const truncated = result.rows.length > MAX_ROWS;
      const rows = truncated ? result.rows.slice(0, MAX_ROWS) : result.rows;

      return {
        columns: result.fields.map((f) => ({
          name: f.name,
          dataTypeID: f.dataTypeID,
        })),
        rows,
        rowCount: rows.length,
        truncated,
        executionTime,
      };
    } catch (error) {
      const pgError = error as { message?: string; code?: string };
      throw new BadRequestException(
        pgError.message || 'Query execution failed',
      );
    } finally {
      await client.end().catch(() => {});
    }
  }

  private createClient(ds: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    sslEnabled: boolean;
  }): Client {
    return new Client({
      host: ds.host,
      port: ds.port,
      database: ds.database,
      user: ds.username,
      password: decrypt(ds.password),
      ssl: ds.sslEnabled ? { rejectUnauthorized: false } : false,
      connectionTimeoutMillis: 10_000,
    });
  }
}
