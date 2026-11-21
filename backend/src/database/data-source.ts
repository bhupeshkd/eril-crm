import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import * as path from 'path';

/**
 * TypeORM CLI data source (migrations). Works both from ts-node (src) and
 * compiled output (dist) because paths are relative to this file.
 */
export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_DATABASE || 'eril',
  entities: [path.join(__dirname, 'entities', '*.entity{.ts,.js}')],
  migrations: [path.join(__dirname, 'migrations', '*{.ts,.js}')],
  synchronize: false,
  logging: false,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
};

export default new DataSource(dataSourceOptions);
