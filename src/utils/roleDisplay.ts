/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Display helpers for user roles and private navigation metadata.
 * Preserves internal stored role keys ('Coach', 'Atleta Pro', 'Nutricionista',
 * 'admin', 'superadmin', 'athlete') without mutating persisted data.
 */

import { NavigationPath } from '../types';

const ROLE_DISPLAY_LABELS: Record<string, string> = {
  'Atleta Pro': 'Atleta Pro',
  Coach: 'Entrenador',
  Nutricionista: 'Nutricionista',
  athlete: 'Atleta',
  admin: 'Administrador',
  superadmin: 'Superadministrador',
};

export function formatUserRoleLabel(role?: string | null): string {
  if (!role) return 'Atleta';
  const trimmed = role.trim();
  return ROLE_DISPLAY_LABELS[trimmed] ?? trimmed;
}

export interface PrivateRouteMeta {
  title: string;
  section: 'Nutrición' | 'Entrenamiento' | 'Cuenta' | 'Administración';
}

export const PRIVATE_ROUTE_META: Partial<Record<NavigationPath, PrivateRouteMeta>> = {
  onboarding: { title: 'Configuración Inicial', section: 'Cuenta' },
  'perfil-atleta': { title: 'Perfil del Atleta', section: 'Cuenta' },
  'dashboard-nutricional': { title: 'Dashboard Nutricional', section: 'Nutrición' },
  'configuracion-nutricional': { title: 'Configuración Nutricional', section: 'Nutrición' },
  'menu-semanal': { title: 'Menú Semanal', section: 'Nutrición' },
  'registro-de-comidas': { title: 'Registro de Comidas', section: 'Nutrición' },
  'registro-diario': { title: 'Registro Diario', section: 'Nutrición' },
  'lista-de-compras': { title: 'Lista de Compras', section: 'Nutrición' },
  sustituciones: { title: 'Sustituciones Alimentarias', section: 'Nutrición' },
  'guia-y-ajustes': { title: 'Guía y Reglas Clínicas', section: 'Nutrición' },
  'planificador-mesociclo': { title: 'Planificador de Mesociclos', section: 'Entrenamiento' },
  'rutina-de-entrenamiento': { title: 'Rutina de Entrenamiento', section: 'Entrenamiento' },
  'registro-de-entrenamiento': { title: 'Registro de Entrenamiento', section: 'Entrenamiento' },
  'cardio-y-hiit': { title: 'Cardio y HIIT', section: 'Entrenamiento' },
  'progreso-del-entrenamiento': { title: 'Progreso del Entrenamiento', section: 'Entrenamiento' },
  'admin-usuarios': { title: 'Gestión de Usuarios', section: 'Administración' },
};
