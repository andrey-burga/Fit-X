import dotenv from 'dotenv';
import path from 'path';

// Load .env if present in POC directory
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export interface CatalystEnvConfig {
  NODE_ENV: string;
  PORT: number;
  ZC_PROJECT_ID?: string;
  ZC_CLIENT_ID?: string;
  ZC_CLIENT_SECRET?: string;
  ZC_REFRESH_TOKEN?: string;
  CATALYST_APP_NAME?: string;
  CATALYST_NOSQL_TABLE: string;
  IS_MOCK_MODE: boolean;
  GCP_PROJECT_ID: string;
  FIRESTORE_DATABASE_ID: string;
}

export function loadEnvConfig(): CatalystEnvConfig {
  const isMock = process.env.CATALYST_MOCK_MODE !== 'false';

  return {
    NODE_ENV: process.env.NODE_ENV || 'test',
    PORT: Number(process.env.PORT) || 3001,
    ZC_PROJECT_ID: process.env.ZC_PROJECT_ID,
    ZC_CLIENT_ID: process.env.ZC_CLIENT_ID,
    ZC_CLIENT_SECRET: process.env.ZC_CLIENT_SECRET,
    ZC_REFRESH_TOKEN: process.env.ZC_REFRESH_TOKEN,
    CATALYST_APP_NAME: process.env.CATALYST_APP_NAME || 'vigorcore-poc',
    CATALYST_NOSQL_TABLE: process.env.CATALYST_NOSQL_TABLE || 'VigorCorePoc',
    IS_MOCK_MODE: isMock,
    GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || 'gen-lang-client-0041212770',
    FIRESTORE_DATABASE_ID: process.env.FIRESTORE_DATABASE_ID || 'ai-studio-vigorcore-f954ab83-f9aa-4846-93b8-a4666a58761c',
  };
}

export function validateLiveEnv(env: CatalystEnvConfig): { isValid: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!env.ZC_PROJECT_ID) missing.push('ZC_PROJECT_ID');
  if (!env.ZC_CLIENT_ID) missing.push('ZC_CLIENT_ID');
  if (!env.ZC_CLIENT_SECRET) missing.push('ZC_CLIENT_SECRET');
  if (!env.ZC_REFRESH_TOKEN) missing.push('ZC_REFRESH_TOKEN');

  return {
    isValid: missing.length === 0,
    missing,
  };
}

export function getSanitizedEnvSummary(env: CatalystEnvConfig) {
  return {
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    CATALYST_APP_NAME: env.CATALYST_APP_NAME,
    CATALYST_NOSQL_TABLE: env.CATALYST_NOSQL_TABLE,
    IS_MOCK_MODE: env.IS_MOCK_MODE,
    GCP_PROJECT_ID: env.GCP_PROJECT_ID,
    FIRESTORE_DATABASE_ID: env.FIRESTORE_DATABASE_ID,
    ZC_PROJECT_ID_CONFIGURED: Boolean(env.ZC_PROJECT_ID),
    ZC_CLIENT_ID_CONFIGURED: Boolean(env.ZC_CLIENT_ID),
    ZC_CLIENT_SECRET_CONFIGURED: Boolean(env.ZC_CLIENT_SECRET),
    ZC_REFRESH_TOKEN_CONFIGURED: Boolean(env.ZC_REFRESH_TOKEN),
  };
}
