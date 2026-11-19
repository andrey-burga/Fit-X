/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Live Workout Execution & Terminal Immutability View
 * Enforces:
 * - Only one `in_progress` workout at a time
 * - `WORKOUT_SET` requires an active `in_progress` parent (`PARENT_WORKOUT_NOT_ACTIVE`)
 * - Closing to `completed` or `abandoned` seals the session as immutable (`WORKOUT_TERMINAL_IMMUTABLE`)
 * - Warmup sets are excluded from effective tonnage & Epley PRs
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock, Play, Plus, XCircle } from 'lucide-react';
import type { WorkoutSetType } from '../contracts/cleanSlateModels';
import { formatWeight, kgToLbs, lbsToKg } from '../domain/nutritionEngine';
import {
  calculateAverageRir,
  calculateEffectiveTonnage,
  calculateEpley1RM,
} from '../domain/workoutEngine';
import { useWorkspace } from '../state/WorkspaceContext';
import { InlineAlert, SectionCard, StatTile, StatePanel } from '../components/UiPrimitives';

export const LiveWorkoutView: React.FC = () => {
  const {
    workspace,
    activeWorkout,
    defaultRoutine,
    startWorkout,
    logWorkoutSet,
    finishWorkout,
    navigate,
  } = useWorkspace();

  const [selectedDayId, setSelectedDayId] = useState<string>(defaultRoutine?.days[0]?.id ?? '');
  const [selectedExerciseId, setSelectedExerciseId] = useState<string>('');
  const [setType, setSetType] = useState<WorkoutSetType>('effective');
  const [weightInput, setWeightInput] = useState<number>(80);
  const [repsInput, setRepsInput] = useState<number>(8);
  const [rirInput, setRirInput] = useState<number>(2);
  const [sessionRpe, setSessionRpe] = useState<number>(8);
  const [sessionNotes, setSessionNotes] = useState<string>('');
  const [guardCheckMsg, setGuardCheckMsg] = useState<string | null>(null);

  const weightUnit = workspace?.preferences?.weightUnit ?? 'kg';
  const workouts = workspace?.executedWorkouts ?? [];
  const allSets = workspace?.workoutSets ?? [];

  const activeSets = useMemo(
    () => (activeWorkout ? allSets.filter(s => s.executedWorkoutId === activeWorkout.id) : []),
    [activeWorkout, allSets]
  );

  const activeExercises = activeWorkout?.exercisesSnapshot ?? [];
  const resolvedExercise =
    activeExercises.find(e => e.exerciseId === selectedExerciseId) ?? activeExercises[0];

  const weightKg = weightUnit === 'lbs' ? lbsToKg(weightInput) : weightInput;
  const preview1RM = calculateEpley1RM(weightKg, repsInput);
  const effectiveTonnage = calculateEffectiveTonnage(activeSets);
  const avgRir = calculateAverageRir(activeSets);

  if (!workspace) return null;

  const handleStartSelectedDay = async () => {
    if (!defaultRoutine) {
      navigate('routines-mesocycle');
      return;
    }
    const day = defaultRoutine.days.find(d => d.id === selectedDayId) ?? defaultRoutine.days[0];
    if (!day) return;
    await startWorkout({
      routineId: defaultRoutine.id,
      routineName: defaultRoutine.name,
      routineDayId: day.id,
      routineDayName: day.name,
      exercisesSnapshot: day.exercises.map(ex => ({
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        muscleGroup: ex.muscleGroup,
        equipment: ex.equipment,
        targetRepsMin: ex.repsMin,
        targetRepsMax: ex.repsMax,
        targetRir: ex.targetRir,
        targetWeightKg: ex.targetWeightKg,
        plannedSets: ex.sets,
      })),
    });
  };

  const handleLogSet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkout || !resolvedExercise) return;
    const sameExerciseCount = activeSets.filter(s => s.exerciseId === resolvedExercise.exerciseId).length;
    await logWorkoutSet({
      executedWorkoutId: activeWorkout.id,
      exerciseId: resolvedExercise.exerciseId,
      exerciseName: resolvedExercise.exerciseName,
      muscleGroup: resolvedExercise.muscleGroup,
      setNumber: sameExerciseCount + 1,
      type: setType,
      weightKg,
      reps: repsInput,
      rir: rirInput,
      completed: true,
    });
  };

  const handleTestTerminalGuard = async (closedWorkoutId: string) => {
    setGuardCheckMsg(null);
    try {
      await logWorkoutSet({
        executedWorkoutId: closedWorkoutId,
        exerciseId: 'barbell_bench_press',
        exerciseName: 'Press de Banca Plano con Barra',
        muscleGroup: 'pecho',
        setNumber: 99,
        type: 'effective',
        weightKg: 80,
        reps: 5,
        rir: 2,
        completed: true,
      });
    } catch (err) {
      setGuardCheckMsg(err instanceof Error ? err.message : 'Bloqueado por inmutabilidad');
    }
  };

  return (
    <div className="space-y-6">
      {!activeWorkout ? (
        <SectionCard
          title="Iniciar Sesión de Entrenamiento"
          subtitle="Las sesiones iniciadas quedan en estado `in_progress` hasta su cierre terminal inmutable"
        >
          {defaultRoutine ? (
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex-1 space-y-1">
                <label htmlFor="live-day-select" className="text-xs font-medium text-ink-muted">
                  Rutina activa: <strong className="text-ink">{defaultRoutine.name}</strong>
                </label>
                <select
                  id="live-day-select"
                  value={selectedDayId || defaultRoutine.days[0]?.id || ''}
                  onChange={e => setSelectedDayId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
                >
                  {defaultRoutine.days.map(d => (
                    <option key={dayKey(d.id)} value={d.id}>
                      {d.name} ({d.exercises.length} ejercicios)
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => void handleStartSelectedDay()}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium cursor-pointer"
              >
                <Play className="w-4 h-4" />
                <span>Iniciar Sesión `in_progress`</span>
              </button>
            </div>
          ) : (
            <StatePanel
              mode="empty"
              title="No hay rutina activa configurada"
              description="Crea o activa una rutina en Rutinas y Mesociclos antes de iniciar una sesión."
              actionLabel="Ir a Rutinas y Mesociclos"
              onAction={() => navigate('routines-mesocycle')}
            />
          )}
        </SectionCard>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile label="Sesión Activa" value={activeWorkout.routineDayName} tone="brand" detail={activeWorkout.routineName} />
            <StatTile
              label="Tonelaje Efectivo"
              value={formatWeight(effectiveTonnage, weightUnit)}
              detail="Excluye series warmup"
            />
            <StatTile
              label="Series Registradas"
              value={activeSets.length}
              detail={`${activeSets.filter(s => s.type === 'warmup').length} de calentamiento`}
            />
            <StatTile
              label="RIR Promedio"
              value={avgRir !== null ? avgRir : '—'}
              tone="info"
              detail="Autorregulación en curso"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <SectionCard
              className="lg:col-span-5"
              title="Registrar Serie"
              subtitle="Validación en vivo de estado padre `in_progress` y cálculo 1RM Epley"
            >
              <form onSubmit={e => void handleLogSet(e)} className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="set-exercise" className="text-xs font-medium text-ink-muted">
                    Ejercicio del snapshot
                  </label>
                  <select
                    id="set-exercise"
                    value={resolvedExercise?.exerciseId ?? ''}
                    onChange={e => {
                      const next = activeExercises.find(x => x.exerciseId === e.target.value);
                      setSelectedExerciseId(e.target.value);
                      if (next) {
                        setWeightInput(
                          weightUnit === 'lbs' ? kgToLbs(next.targetWeightKg) : next.targetWeightKg
                        );
                        setRepsInput(next.targetRepsMin);
                        setRirInput(next.targetRir);
                      }
                    }}
                    className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
                  >
                    {activeExercises.map(ex => (
                      <option key={ex.exerciseId} value={ex.exerciseId}>
                        {ex.exerciseName} (meta {ex.targetRepsMin}-{ex.targetRepsMax} reps · RIR {ex.targetRir})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="set-type" className="text-xs font-medium text-ink-muted">
                      Tipo de serie
                    </label>
                    <select
                      id="set-type"
                      value={setType}
                      onChange={e => setSetType(e.target.value as WorkoutSetType)}
                      className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
                    >
                      <option value="effective">Efectiva</option>
                      <option value="warmup">Calentamiento (warmup)</option>
                      <option value="dropset">Dropset</option>
                      <option value="failure">Al fallo técnico</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="set-weight" className="text-xs font-medium text-ink-muted">
                      Carga ({weightUnit})
                    </label>
                    <input
                      id="set-weight"
                      type="number"
                      step="0.5"
                      min={0}
                      max={1000}
                      value={weightInput}
                      onChange={e => setWeightInput(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="set-reps" className="text-xs font-medium text-ink-muted">
                      Repeticiones
                    </label>
                    <input
                      id="set-reps"
                      type="number"
                      min={1}
                      max={100}
                      value={repsInput}
                      onChange={e => setRepsInput(Math.max(1, Number(e.target.value) || 1))}
                      className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="set-rir" className="text-xs font-medium text-ink-muted">
                      RIR (0 = fallo)
                    </label>
                    <input
                      id="set-rir"
                      type="number"
                      min={0}
                      max={10}
                      value={rirInput}
                      onChange={e => setRirInput(Math.min(10, Math.max(0, Number(e.target.value) || 0)))}
                      className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink font-mono"
                    />
                  </div>
                </div>

                <div className="rounded-lg bg-surface-alt/60 border border-border px-3 py-2 text-xs flex items-center justify-between">
                  <span className="text-ink-muted">1RM Epley estimado:</span>
                  <span className="font-mono font-semibold text-brand">
                    {setType === 'warmup' ? 'Excluido (warmup)' : formatWeight(preview1RM, weightUnit)}
                  </span>
                </div>

                <button
                  type="submit"
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Guardar Serie</span>
                </button>
              </form>

              <div className="border-t border-border pt-4 space-y-3">
                <div className="text-xs font-semibold text-ink">Cierre Terminal Inmutable</div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <label htmlFor="wk-rpe" className="text-[11px] text-ink-muted">
                      RPE sesión
                    </label>
                    <input
                      id="wk-rpe"
                      type="number"
                      min={1}
                      max={10}
                      value={sessionRpe}
                      onChange={e => setSessionRpe(Math.min(10, Math.max(1, Number(e.target.value) || 8)))}
                      className="w-full rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs text-ink font-mono"
                    />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <label htmlFor="wk-notes" className="text-[11px] text-ink-muted">
                      Notas finales
                    </label>
                    <input
                      id="wk-notes"
                      type="text"
                      placeholder="Sensaciones o ajustes..."
                      value={sessionNotes}
                      onChange={e => setSessionNotes(e.target.value)}
                      className="w-full rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs text-ink"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void finishWorkout(activeWorkout.id, 'completed', {
                        durationSeconds: 3200,
                        sessionRpe,
                        notes: sessionNotes || undefined,
                      })
                    }
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-medium cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Completar Sesión</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void finishWorkout(activeWorkout.id, 'abandoned', {
                        durationSeconds: 600,
                        sessionRpe,
                        notes: sessionNotes || 'Abandonada por el atleta',
                      })
                    }
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-danger/40 text-danger hover:bg-danger-soft text-xs font-medium cursor-pointer"
                  >
                    <XCircle className="w-4 h-4" />
                    <span>Abandonar</span>
                  </button>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              className="lg:col-span-7"
              title={`Series de la Sesión (${activeSets.length})`}
              subtitle="Las series `warmup` se registran para trazabilidad, pero se excluyen del tonelaje efectivo"
            >
              {activeSets.length === 0 ? (
                <StatePanel
                  mode="empty"
                  title="Sin series registradas aún"
                  description="Registra la primera serie usando el formulario lateral."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-border text-ink-muted">
                      <tr>
                        <th className="py-2 pr-3">Ejercicio</th>
                        <th className="py-2 pr-3">Serie</th>
                        <th className="py-2 pr-3">Tipo</th>
                        <th className="py-2 pr-3">Carga</th>
                        <th className="py-2 pr-3">Reps</th>
                        <th className="py-2 pr-3">RIR</th>
                        <th className="py-2">1RM Epley</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-mono tabular-nums">
                      {activeSets.map(s => (
                        <tr key={s.id}>
                          <td className="py-2 pr-3 font-sans font-medium text-ink">{s.exerciseName}</td>
                          <td className="py-2 pr-3 text-ink-muted">#{s.setNumber}</td>
                          <td className="py-2 pr-3 font-sans">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                                s.type === 'warmup'
                                  ? 'bg-surface-alt text-ink-muted'
                                  : 'bg-brand-soft text-brand-ink'
                              }`}
                            >
                              {s.type}
                            </span>
                          </td>
                          <td className="py-2 pr-3 text-ink">{formatWeight(s.weightKg, weightUnit)}</td>
                          <td className="py-2 pr-3 text-ink">{s.reps}</td>
                          <td className="py-2 pr-3 text-ink">{s.rir}</td>
                          <td className="py-2 text-brand">
                            {s.type === 'warmup' ? 'Excluido' : formatWeight(s.estimated1RM, weightUnit)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </div>
        </>
      )}

      {/* Historical Immutable Sessions */}
      <SectionCard
        title="Historial de Sesiones Ejecutadas e Inmutabilidad Terminal"
        subtitle="Las sesiones `completed` o `abandoned` bloquean cualquier nueva inserción de series (`PARENT_WORKOUT_NOT_ACTIVE`)"
      >
        {guardCheckMsg && (
          <InlineAlert tone="warning" title="Bloqueo de Inmutabilidad Verificado (HTTP 409)">
            {guardCheckMsg}
          </InlineAlert>
        )}

        {workouts.length === 0 ? (
          <StatePanel
            mode="empty"
            title="Sin historial de sesiones"
            description="Tus entrenamientos completados aparecerán aquí sellados como inmutables."
          />
        ) : (
          <div className="divide-y divide-border">
            {workouts.slice(0, 8).map(w => {
              const isTerminal = w.status === 'completed' || w.status === 'abandoned';
              return (
                <div key={w.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-ink">{w.routineDayName}</span>
                      {isTerminal ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-surface-alt border border-border text-ink-muted">
                          <Lock className="w-3 h-3" /> {w.status} (Inmutable)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded bg-brand-soft text-brand-ink">
                          in_progress
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-muted font-mono tabular-nums">
                      {w.startedAt.slice(0, 10)} · {w.totalCompletedSets} series efectivas ·{' '}
                      {formatWeight(w.totalTonnageKg, weightUnit)} · RIR prom: {w.averageRir ?? '—'}
                    </div>
                  </div>
                  {isTerminal && (
                    <button
                      type="button"
                      onClick={() => void handleTestTerminalGuard(w.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-alt text-xs text-ink-muted cursor-pointer shrink-0"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-warn" />
                      <span>Probar Bloqueo 409</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
};

function dayKey(id: string): string {
  return id;
}
