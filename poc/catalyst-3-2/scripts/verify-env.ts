import { loadEnvConfig, validateLiveEnv, getSanitizedEnvSummary } from '../src/config/env.js';
import fs from 'fs';
import path from 'path';

async function verifyEnvironment() {
  console.log('====================================================');
  console.log(' AUDITORÍA DE SEGURIDAD Y VARIABLES DE ENTORNO POC  ');
  console.log('====================================================');

  const env = loadEnvConfig();
  console.log('1. Resumen Sanitizado (Cero Secretos Expuestos):');
  console.log(JSON.stringify(getSanitizedEnvSummary(env), null, 2));

  console.log('\n2. Validación de Estado Operativo:');
  const liveValidation = validateLiveEnv(env);
  if (liveValidation.isValid) {
    console.log(' -> MODO REMOTO ACTIVO: Credenciales de Catalyst presentes.');
  } else {
    console.log(' -> MODO AISLADO / MOCK: Credenciales remotas no configuradas.');
    console.log('    Variables pendientes para entorno Catalyst remoto:', liveValidation.missing);
    console.log('    (Nota: Las pruebas unitarias y de arquitectura se ejecutan de forma segura en modo mock aislado).');
  }

  console.log('\n3. Comprobación de Exclusión Git (.gitignore):');
  const rootGitignorePath = path.resolve(process.cwd(), '../../.gitignore');
  const pocGitignorePath = path.resolve(process.cwd(), '.gitignore');

  const rootHasIgnore = fs.existsSync(rootGitignorePath) && fs.readFileSync(rootGitignorePath, 'utf-8').includes('.env');
  const pocHasIgnore = fs.existsSync(pocGitignorePath) && fs.readFileSync(pocGitignorePath, 'utf-8').includes('.env');

  console.log(' - Raíz .gitignore excluye .env*:', rootHasIgnore);
  console.log(' - POC .gitignore excluye .env*:', pocHasIgnore);

  if (rootHasIgnore && pocHasIgnore) {
    console.log(' -> REGLA DE SEGURIDAD APROBADA: .env está estrictamente protegido contra commits.');
  } else {
    console.warn(' -> ADVERTENCIA: Verifique las reglas de .gitignore.');
  }
}

verifyEnvironment().catch((err) => {
  console.error('Error durante la verificación de entorno:', err);
  process.exit(1);
});
