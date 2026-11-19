/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Training Analytics, ACWR, RIR Autoregulation & CSV Export
 */

import React, { useMemo, useState } from 'react';
import { Download, TrendingUp } from 'lucide-react';
import { formatWeight } from '../domain/nutritionEngine';
import {
  computeTrainingAnalytics,
  generateRoutineDayAutoregulation,
  serializeWorkoutsToCsv,
} from '../domain/workoutEngine';
import { useWorkspace } from '../state/WorkspaceContext';
import { InlineAlert, SectionCard, StatTile, StatePanel } from '../components/UiPrimitives';

export const TrainingProgressView: React.FC = () => {
  const { workspace, defaultRoutine, notifyToast } = useWorkspace();
  const [period, setPeriod] = useState<'4w' | '12w' | '24w' | 'all'>('12w');
  const [selectedDayIdx, setSelectedDayIdx] = useState<number>(0);

  const weightUnit = workspace?.preferences?.weightUnit ?? 'kg';
  const workouts = workspace?.executedWorkouts ?? [];
  const sets = workspace?.workoutSets ?? [];

  const analytics = useMemo(
    () => computeTrainingAnalytics(workouts, sets, period),
    [workouts, sets, period]
  );

  const selectedDay = defaultRoutine?.days[selectedDayIdx] ?? defaultRoutine?.days[0];
  const autoregulation = useMemo(
    () => (selectedDay ? generateRoutineDayAutoregulation(selectedDay, workouts, sets) : []),
    [selectedDay, workouts, sets]
  );

  if (!workspace) return null;

  const maxWeeklyTonnage = Math.max(1, ...analytics.weeklyPoints.map(p => p.tonnageKg));

  const handleDownloadCsv = () => {
    const csv = serializeWorkoutsToCsv(workouts, sets);
    if (typeof document === 'undefined') return;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vigorcore-entrenamientos-${period}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    notifyToast('Exportación CSV generada localmente', 'success');
  };

  return (
    <div className="space-y-6">
      {/* Period Selector & CSV Export */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface border border-border rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-muted mr-1">Ventana temporal:</span>
          {(
            [
              { id: '4w', label: '4 semanas' },
              { id: '12w', label: '12 semanas' },
              { id: '24w', label: '24 semanas' },
              { id: 'all', label: 'Todo' },
            ] as const
          ).map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setPeriod(opt.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                period === opt.id
                  ? 'bg-brand text-white'
                  : 'bg-surface-alt text-ink-muted hover:text-ink'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={sets.length === 0}
          onClick={handleDownloadCsv}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border bg-surface hover:bg-surface-alt disabled:opacity-50 text-xs font-medium text-ink cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Exportar Series CSV</span>
        </button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile
          label="Sesiones Completadas"
          value={analytics.totalCompletedWorkouts}
          detail="Solo estado terminal completed"
        />
        <StatTile
          label="Tonelaje Efectivo"
          value={formatWeight(analytics.totalEffectiveTonnageKg, weightUnit)}
          tone="brand"
          detail={`${analytics.totalWarmupSetsExcluded} series warmup excluidas`}
        />
        <StatTile
          label="Series Efectivas"
          value={analytics.totalEffectiveSets}
          detail="Excluye calentamiento"
        />
        <StatTile
          label="RIR Promedio"
          value={analytics.averageRir !== null ? analytics.averageRir : '—'}
          tone="info"
          detail="Reserva técnica promedio"
        />
      </div>

      {workouts.length === 0 ? (
        <StatePanel
          mode="empty"
          title="Sin entrenamientos ejecutados en el periodo"
          description="Completa sesiones en Sesión Activa para visualizar ACWR, 1RM Epley y progresión semanal."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            {/* ACWR Card */}
            <SectionCard
              className="lg:col-span-5"
              title="Ratio Agudo:Crónico (ACWR)"
              subtitle="Carga últimos 7 días vs. promedio semanal crónico de 4 semanas"
            >
              <div className="rounded-xl border border-border bg-surface-alt/50 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ink-muted">Estado ACWR</span>
                  <span className="text-xs font-semibold text-brand">{analytics.acwr.statusLabel}</span>
                </div>
                <div className="text-3xl font-bold font-mono tabular-nums text-ink">
                  {analytics.acwr.isCalculable && analytics.acwr.acwrRatio !== null
                    ? analytics.acwr.acwrRatio.toFixed(2)
                    : 'Pendiente'}
                </div>
                <p className="text-xs text-ink-muted">{analytics.acwr.message}</p>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
                <div className="rounded-lg border border-border bg-canvas p-2.5">
                  <span className="text-ink-muted block font-sans">Carga 7d</span>
                  <strong className="text-ink">{formatWeight(analytics.acwr.acuteTonnageKg, weightUnit)}</strong>
                </div>
                <div className="rounded-lg border border-border bg-canvas p-2.5">
                  <span className="text-ink-muted block font-sans">Media 28d</span>
                  <strong className="text-ink">{formatWeight(analytics.acwr.chronicWeeklyAvgKg, weightUnit)}</strong>
                </div>
                <div className="rounded-lg border border-border bg-canvas p-2.5">
                  <span className="text-ink-muted block font-sans">Historial</span>
                  <strong className="text-ink">{analytics.acwr.historyDays} días</strong>
                </div>
              </div>
            </SectionCard>

            {/* Weekly Tonnage Bar Chart */}
            <SectionCard
              className="lg:col-span-7"
              title="Tonelaje Semanal Efectivo"
              subtitle="Excluye estrictamente series de calentamiento (warmup)"
            >
              <div className="flex items-end gap-2 h-44 pt-4">
                {analytics.weeklyPoints.map(pt => {
                  const pct = Math.max(4, Math.round((pt.tonnageKg / maxWeeklyTonnage) * 100));
                  return (
                    <div key={pt.label} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                      <span className="text-[10px] font-mono tabular-nums text-ink-muted">
                        {pt.tonnageKg > 0 ? `${Math.round(pt.tonnageKg / 100) / 10}t` : '0'}
                      </span>
                      <div className="w-full max-w-10 bg-surface-alt rounded-t-md h-28 flex items-end overflow-hidden border border-border">
                        <div
                          className="w-full bg-brand transition-all rounded-t-sm"
                          style={{ height: `${pt.tonnageKg === 0 ? 2 : pct}%` }}
                          title={`${pt.label}: ${pt.tonnageKg} kg (${pt.effectiveSets} series)`}
                        />
                      </div>
                      <span className="text-[11px] text-ink-muted">{pt.label}</span>
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          </div>

          {/* 1RM Epley Table */}
          <SectionCard
            title="Progresión de Fuerza Estimada (1RM Epley)"
            subtitle="Calculada exclusivamente sobre series efectivas de sesiones `completed`"
          >
            {analytics.exerciseSummaries.length === 0 ? (
              <InlineAlert tone="info">Aún no hay series efectivas completadas para calcular 1RM.</InlineAlert>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-border text-ink-muted">
                    <tr>
                      <th className="py-2 pr-3">Ejercicio</th>
                      <th className="py-2 pr-3">Grupo</th>
                      <th className="py-2 pr-3">Sesiones</th>
                      <th className="py-2 pr-3">Última marca</th>
                      <th className="py-2 pr-3">Mejor carga</th>
                      <th className="py-2">Mejor 1RM Epley</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border font-mono tabular-nums">
                    {analytics.exerciseSummaries.map(ex => (
                      <tr key={ex.exerciseId}>
                        <td className="py-2.5 pr-3 font-sans font-medium text-ink">{ex.exerciseName}</td>
                        <td className="py-2.5 pr-3 font-sans capitalize text-ink-muted">{ex.muscleGroup}</td>
                        <td className="py-2.5 pr-3 text-ink">{ex.sessionsCount}</td>
                        <td className="py-2.5 pr-3 text-ink">
                          {formatWeight(ex.latestWeightKg, weightUnit)} × {ex.latestReps} (RIR {ex.latestRir ?? '—'})
                        </td>
                        <td className="py-2.5 pr-3 text-ink">{formatWeight(ex.bestWeightKg, weightUnit)}</td>
                        <td className="py-2.5 font-semibold text-brand">{formatWeight(ex.best1RM, weightUnit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* RIR Double Progression Autoregulation */}
          {defaultRoutine && (
            <SectionCard
              title="Motor de Autorregulación (Doble Progresión por RIR)"
              subtitle={`Recomendaciones para tu próxima sesión de ${defaultRoutine.name}`}
              action={
                <select
                  aria-label="Seleccionar día para autorregulación"
                  value={selectedDayIdx}
                  onChange={e => setSelectedDayIdx(Number(e.target.value))}
                  className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink"
                >
                  {defaultRoutine.days.map((d, idx) => (
                    <option key={d.id} value={idx}>
                      {d.name}
                    </option>
                  ))}
                </select>
              }
            >
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {autoregulation.map(rec => (
                  <div
                    key={rec.exerciseId}
                    className="rounded-xl border border-border bg-surface-alt/40 p-3.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink flex items-center gap-1.5">
                        <TrendingUp className="w-3.5 h-3.5 text-brand" />
                        {rec.exerciseName}
                      </span>
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded ${
                          rec.action === 'increase_load'
                            ? 'bg-brand-soft text-brand-ink'
                            : 'bg-surface border border-border text-ink-muted'
                        }`}
                      >
                        {rec.badgeLabel}
                      </span>
                    </div>
                    <div className="text-xs text-ink-muted">{rec.reason}</div>
                    <div className="text-xs font-mono tabular-nums text-ink pt-1">
                      Actual: {formatWeight(rec.currentWeightKg, weightUnit)} → Sugerido:{' '}
                      <strong className="text-brand">{formatWeight(rec.suggestedWeightKg, weightUnit)}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </>
      )}
    </div>
  );
};
