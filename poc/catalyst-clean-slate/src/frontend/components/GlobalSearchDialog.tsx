/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Global Quick Search Dialog across views, recipes, foods & exercises
 */

import React, { useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { ViewId } from '../contracts/cleanSlateModels';
import { FOOD_CATALOG } from '../domain/nutritionEngine';
import { EXERCISE_CATALOG } from '../domain/workoutEngine';
import { useWorkspace } from '../state/WorkspaceContext';

interface GlobalSearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const VIEW_DIRECTORY: Array<{ id: ViewId; label: string; group: string }> = [
  { id: 'dashboard', label: 'Dashboard del Atleta', group: 'Resumen' },
  { id: 'profile-biometrics', label: 'Perfil, Biometría & Onboarding', group: 'Cuenta' },
  { id: 'nutrition-log', label: 'Registro de Comidas & Cumplimiento', group: 'Nutrición' },
  { id: 'meal-plan', label: 'Menú Semanal & Periodización', group: 'Nutrición' },
  { id: 'recipes-substitutions', label: 'Recetas & Sustituciones', group: 'Nutrición' },
  { id: 'shopping-list', label: 'Lista de Compras (Batch Sync)', group: 'Nutrición' },
  { id: 'routines-mesocycle', label: 'Rutinas & Planificador Mesociclo', group: 'Entrenamiento' },
  { id: 'live-workout', label: 'Sesión Activa & Registro de Series', group: 'Entrenamiento' },
  { id: 'training-progress', label: 'Progreso, ACWR & Autorregulación', group: 'Entrenamiento' },
  { id: 'cardio-hiit', label: 'Cardio & Protocolos HIIT', group: 'Entrenamiento' },
  { id: 'notifications', label: 'Centro de Notificaciones', group: 'Sistema' },
  { id: 'admin-console', label: 'Consola Administrativa (Mock RBAC)', group: 'Administración' },
  { id: 'preauth-contracts', label: 'Guía & Contratos Pre-Auth Catalyst', group: 'Arquitectura' },
];

export const GlobalSearchDialog: React.FC<GlobalSearchDialogProps> = ({ isOpen, onClose }) => {
  const { navigate, workspace } = useWorkspace();
  const [query, setQuery] = useState('');

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const views = VIEW_DIRECTORY.filter(
      v => !q || v.label.toLowerCase().includes(q) || v.group.toLowerCase().includes(q)
    ).slice(0, 5);

    const recipes = (workspace?.recipes ?? [])
      .filter(r => !q || r.name.toLowerCase().includes(q))
      .slice(0, 3);

    const foods = FOOD_CATALOG.filter(f => !q || f.name.toLowerCase().includes(q)).slice(0, 4);
    const exercises = EXERCISE_CATALOG.filter(
      e => !q || e.name.toLowerCase().includes(q) || e.muscleGroup.toLowerCase().includes(q)
    ).slice(0, 4);

    return { views, recipes, foods, exercises };
  }, [query, workspace?.recipes]);

  if (!isOpen) return null;

  const jump = (view: ViewId) => {
    navigate(view);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Búsqueda rápida en VigorCore"
      className="fixed inset-0 z-50 bg-ink/40 flex items-start justify-center pt-16 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-surface border border-border rounded-xl shadow-lg overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-ink-muted shrink-0" aria-hidden="true" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar vistas, recetas semilla, alimentos (catálogo local) o ejercicios..."
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar búsqueda"
            className="p-1 rounded hover:bg-surface-alt text-ink-muted cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-3 space-y-4">
          {results.views.length > 0 && (
            <div>
              <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Vistas y Módulos
              </div>
              <div className="space-y-1">
                {results.views.map(v => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => jump(v.id)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left hover:bg-surface-alt text-ink cursor-pointer"
                  >
                    <span className="font-medium">{v.label}</span>
                    <span className="text-xs text-ink-muted">{v.group}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {results.recipes.length > 0 && (
            <div>
              <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Recetas guardadas
              </div>
              <div className="space-y-1">
                {results.recipes.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => jump('recipes-substitutions')}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left hover:bg-surface-alt text-ink cursor-pointer"
                  >
                    <span>{r.name}</span>
                    <span className="text-xs font-mono tabular-nums text-ink-muted">
                      {r.totalNutrients.calories} kcal
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {results.foods.length > 0 && (
            <div>
              <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Alimentos (Catálogo local simulado)
              </div>
              <div className="space-y-1">
                {results.foods.map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => jump('recipes-substitutions')}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left hover:bg-surface-alt text-ink cursor-pointer"
                  >
                    <span>{f.name}</span>
                    <span className="text-xs font-mono tabular-nums text-ink-muted">
                      {f.proteinPer100g}g P / 100g
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {results.exercises.length > 0 && (
            <div>
              <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Ejercicios (Catálogo local simulado)
              </div>
              <div className="space-y-1">
                {results.exercises.map(ex => (
                  <button
                    key={ex.id}
                    type="button"
                    onClick={() => jump('routines-mesocycle')}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm text-left hover:bg-surface-alt text-ink cursor-pointer"
                  >
                    <span>{ex.name}</span>
                    <span className="text-xs text-ink-muted capitalize">{ex.muscleGroup}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
