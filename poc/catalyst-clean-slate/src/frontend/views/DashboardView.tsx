/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Athlete Dashboard View
 */

import React, { useMemo } from 'react';
import { ArrowRight, Bell, Dumbbell, HeartPulse, Play, Plus, ShoppingCart, Utensils } from 'lucide-react';
import { formatWeight } from '../domain/nutritionEngine';
import { computeTrainingAnalytics } from '../domain/workoutEngine';
import { useWorkspace } from '../state/WorkspaceContext';
import { InlineAlert, SectionCard, StatTile, StatePanel } from '../components/UiPrimitives';

export const DashboardView: React.FC = () => {
  const {
    workspace,
    todayMacros,
    activeWorkout,
    defaultRoutine,
    unreadNotificationsCount,
    navigate,
  } = useWorkspace();

  const analytics = useMemo(
    () =>
      computeTrainingAnalytics(
        workspace?.executedWorkouts ?? [],
        workspace?.workoutSets ?? [],
        '4w'
      ),
    [workspace?.executedWorkouts, workspace?.workoutSets]
  );

  if (!workspace) return null;

  const bio = workspace.biometrics;
  const weightUnit = workspace.preferences?.weightUnit ?? 'kg';
  const targetKcal = bio?.targetCalories ?? 0;
  const targetProt = bio?.targetProteinG ?? 0;
  const targetCarbs = bio?.targetCarbsG ?? 0;
  const targetFat = bio?.targetFatG ?? 0;
  const pendingGroceries = workspace.groceries.filter(g => g.status === 'pending').length;

  const isEmpty = !bio && workspace.mealLogs.length === 0 && workspace.executedWorkouts.length === 0;

  if (isEmpty) {
    return (
      <StatePanel
        mode="empty"
        title="Espacio de trabajo sin configurar"
        description="Aún no has completado tu perfil biométrico ni registrado comidas o sesiones. Inicia el flujo guiado de onboarding para calcular tus metas."
        actionLabel="Completar Perfil & Biometría"
        onAction={() => navigate('profile-biometrics')}
      />
    );
  }

  const kcalPct = targetKcal > 0 ? Math.min(100, Math.round((todayMacros.calories / targetKcal) * 100)) : 0;

  return (
    <div className="space-y-6">
      {/* Top Contextual Action Banner */}
      {activeWorkout ? (
        <InlineAlert
          tone="info"
          title={`Sesión de entrenamiento en curso: ${activeWorkout.routineDayName}`}
          action={
            <button
              type="button"
              onClick={() => navigate('live-workout')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Continuar sesión</span>
            </button>
          }
        >
          Tonelaje efectivo acumulado: {activeWorkout.totalTonnageKg} kg · {activeWorkout.totalCompletedSets} series efectivas.
        </InlineAlert>
      ) : (
        <div className="bg-surface border border-border rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-brand">
              Resumen de hoy · {workspace.profile.displayName}
            </div>
            <h2 className="text-lg font-bold text-ink mt-0.5">
              Objetivo activo: {workspace.profile.goal ?? 'hipertrofia'}
            </h2>
            <p className="text-sm text-ink-muted mt-0.5">
              {bio
                ? `Meta diaria ${targetKcal} kcal (${targetProt}g P · ${targetCarbs}g C · ${targetFat}g G) · Peso actual ${formatWeight(bio.weightKg, weightUnit)}.`
                : 'Configura tu biometría para activar metas automáticas.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate('nutrition-log')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Registrar comida</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('live-workout')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-border bg-canvas hover:bg-surface-alt text-ink text-sm font-medium cursor-pointer"
            >
              <Dumbbell className="w-4 h-4" />
              <span>Entrenar</span>
            </button>
          </div>
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label="Calorías Hoy"
          value={`${todayMacros.calories} kcal`}
          detail={targetKcal > 0 ? `${kcalPct}% de ${targetKcal} kcal objetivo` : 'Sin meta configurada'}
          tone="brand"
        />
        <StatTile
          label="Proteína Hoy"
          value={`${todayMacros.protein} g`}
          detail={targetProt > 0 ? `Objetivo: ${targetProt} g (${bio?.proteinPerKg} g/kg)` : `${todayMacros.mealsCount} tomas`}
        />
        <StatTile
          label="Tonelaje (4 sem)"
          value={`${analytics.totalEffectiveTonnageKg.toLocaleString()} kg`}
          detail={`${analytics.totalCompletedWorkouts} sesiones completadas`}
          tone="info"
        />
        <StatTile
          label="Compras & Avisos"
          value={`${pendingGroceries} ítems`}
          detail={`${unreadNotificationsCount} notificaciones sin leer`}
          tone={unreadNotificationsCount > 0 ? 'warn' : 'neutral'}
        />
      </div>

      {/* Main Two-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <SectionCard
          title="Balance Nutricional de Hoy"
          subtitle="Cálculo exclusivo sobre comidas registradas hoy (días vacíos permanecen sin registrar)"
          className="lg:col-span-2"
          action={
            <button
              type="button"
              onClick={() => navigate('nutrition-log')}
              className="text-xs font-medium text-brand hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Ver registro completo</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          }
        >
          <div className="space-y-3">
            {[
              { label: 'Calorías', val: todayMacros.calories, target: targetKcal || 1, unit: 'kcal' },
              { label: 'Proteínas', val: todayMacros.protein, target: targetProt || 1, unit: 'g' },
              { label: 'Carbohidratos', val: todayMacros.carbs, target: targetCarbs || 1, unit: 'g' },
              { label: 'Grasas', val: todayMacros.fat, target: targetFat || 1, unit: 'g' },
            ].map(row => {
              const pct = Math.min(100, Math.round((row.val / row.target) * 100));
              return (
                <div key={row.label} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-ink">{row.label}</span>
                    <span className="font-mono tabular-nums text-ink-muted">
                      <strong className="text-ink">{row.val}</strong> / {row.target} {row.unit} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-alt overflow-hidden">
                    <div className="h-full bg-brand rounded-full transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => navigate('meal-plan')}
              className="p-3 rounded-lg border border-border hover:bg-surface-alt text-left cursor-pointer"
            >
              <Utensils className="w-4 h-4 text-brand mb-1" />
              <div className="text-xs font-semibold text-ink">Menú Semanal</div>
              <div className="text-[11px] text-ink-muted">{workspace.mealPlans.length} plan(es)</div>
            </button>
            <button
              type="button"
              onClick={() => navigate('shopping-list')}
              className="p-3 rounded-lg border border-border hover:bg-surface-alt text-left cursor-pointer"
            >
              <ShoppingCart className="w-4 h-4 text-brand mb-1" />
              <div className="text-xs font-semibold text-ink">Lista de Compras</div>
              <div className="text-[11px] text-ink-muted">{pendingGroceries} pendientes</div>
            </button>
            <button
              type="button"
              onClick={() => navigate('cardio-hiit')}
              className="p-3 rounded-lg border border-border hover:bg-surface-alt text-left cursor-pointer"
            >
              <HeartPulse className="w-4 h-4 text-brand mb-1" />
              <div className="text-xs font-semibold text-ink">Cardio & HIIT</div>
              <div className="text-[11px] text-ink-muted">{workspace.cardioSessions.length} sesiones</div>
            </button>
          </div>
        </SectionCard>

        <SectionCard
          title="Rutina & Notificaciones"
          subtitle="Estado del bloque actual"
          action={
            <button
              type="button"
              onClick={() => navigate('notifications')}
              className="text-xs font-medium text-brand hover:underline cursor-pointer"
            >
              Ver avisos
            </button>
          }
        >
          <div className="p-3.5 rounded-lg bg-surface-alt border border-border space-y-1.5">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Rutina Activa
            </div>
            <div className="text-sm font-semibold text-ink">
              {defaultRoutine?.name ?? 'Sin rutina asignada'}
            </div>
            <div className="text-xs text-ink-muted">
              {defaultRoutine
                ? `${defaultRoutine.frequencyDays} días/sem · ${defaultRoutine.goal}`
                : 'Genera un mesociclo para iniciar.'}
            </div>
            <button
              type="button"
              onClick={() => navigate(defaultRoutine ? 'live-workout' : 'routines-mesocycle')}
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline cursor-pointer"
            >
              <span>{defaultRoutine ? 'Ir a sesión en vivo' : 'Crear mesociclo'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-2">
            {workspace.notifications.slice(0, 3).map(n => (
              <div
                key={n.id}
                className={`p-3 rounded-lg border text-xs space-y-0.5 ${
                  n.read ? 'border-border bg-canvas text-ink-muted' : 'border-brand/30 bg-brand-soft/40 text-ink'
                }`}
              >
                <div className="font-semibold flex items-center gap-1.5">
                  <Bell className="w-3.5 h-3.5 text-brand shrink-0" />
                  <span>{n.title}</span>
                </div>
                <p className="text-ink-muted">{n.message}</p>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
};
