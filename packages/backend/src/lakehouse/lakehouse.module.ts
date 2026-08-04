import { Module } from '@nestjs/common';
import { DuckDbService } from './duckdb.service';

/**
 * The embedded DuckDB engine. Holds only the service today — LH-0 grows this
 * into the lakehouse connection model (sources, secrets, time travel); file
 * import (FI-2/3/4) needs just the engine.
 */
@Module({
  providers: [DuckDbService],
  exports: [DuckDbService],
})
export class LakehouseModule {}
