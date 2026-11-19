/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Workout Routines & Mesocycle Periodization Configurator
 */

import React, { useMemo, useState } from 'react';
import { CalendarRange, CheckCircle2, Dumbbell, Play } from 'lucide-react';
import type {
  AthleteGoal,
  EquipmentRequired,
  MesocycleDurationWeeks,
  RoutineDay,
  TrainingExperience,
} from '../contracts/cleanSlateModels';
import { estimateUtf8Bytes } from '../domain/validators';
import { generateMesocycleProgram } from '../domain/workoutEngine';
import { useWorkspace } from '../state/WorkspaceContext';
import { InlineAlert, PayloadBudgetMeter, SectionCard, StatePanel } from '../components/UiPrimitives';

const EQUIPMENT_OPTIONS: Array<{ id: EquipmentRequired; label: string }> = [
  { id: 'barra', label: 'Barra Olímpica' },
  { id: 'mancuerna', label: 'Mancuernas' },
  { id: 'polea', label: 'Poleas' },
  { id: 'maquina', label: 'Máquinas' },
  { id: 'peso_corporal', label: 'Peso Corporal' },
];

export const RoutinesAndMesocycleView: React.FC = () => {
  const { workspace, saveWorkoutRoutine, setDefaultRoutine, startWorkout, navigate, activeWorkout } = useWorkspace();

  const [mesoName, setMesoName] = useState('Mesociclo Hipertrofia Controlada');
  const [goal, setGoal] = useState<AthleteGoal>('hipertrofia');
  const [experience, setExperience] = useState<TrainingExperience>('intermedio');
  const [daysPerWeek, setDaysPerWeek] = useState<number>(4);
  const [durationWeeks, setDurationWeeks] = useState<MesocycleDurationWeeks>(6);
  const [includeDeloadWeek, setIncludeDeloadWeek] = useState<boolean>(true);
  const [equipment, setEquipment] = useState<EquipmentRequired[]>([
    'barra',
    'mancuerna',
    'polea',
    'maquina',
    'peso_corporal',
  ]);
  const [savingMeso, setSavingMeso] = useState(false);

  const previewProgram = useMemo(
    () =>
      generateMesocycleProgram({
        name: mesoName,
        goal,
        experience,
        daysPerWeek,
        durationWeeks,
        availableEquipment: equipment,
        includeDeloadWeek,
      }),
    [mesoName, goal, experience, daysPerWeek, durationWeeks, equipment, includeDeloadWeek]
  );

  const previewBytes = useMemo(() => estimateUtf8Bytes(previewProgram), [previewProgram]);

  if (!workspace) return null;

  const toggleEquipment = (eq: EquipmentRequired) => {
    setEquipment(prev =>
      prev.includes(eq) ? (prev.length > 1 ? prev.filter(x => x !== eq) : prev) : [...prev, eq]
    );
  };

  const handleSaveMesocycle = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingMeso(true);
    try {
      await saveWorkoutRoutine(previewProgram);
    } finally {
      setSavingMeso(false);
    }
  };

  const handleLaunchDay = async (routineId: string, routineName: string, day: RoutineDay) => {
    if (activeWorkout) {
      navigate('live-workout');
      return;
    }
    await startWorkout({
      routineId,
      routineName,
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
    navigate('live-workout');
  };

  return (
    <div className="space-y-6">
      {activeWorkout && (
        <InlineAlert
          tone="info"
          title={`Sesión en curso: ${activeWorkout.routineDayName}`}
          action={
            <button
              type="button"
              onClick={() => navigate('live-workout')}
              className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-medium cursor-pointer"
            >
              Ir a Sesión Activa
            </button>
          }
        >
          Solo puede existir una sesión `ExecutedWorkout` en estado `in_progress` simultáneamente.
        </InlineAlert>
      )}

      {/* Mesocycle Generator */}
      <SectionCard
        title="Planificador de Mesociclos (4 / 6 / 8 Semanas)"
        subtitle="Genera progresión de volumen y RIR objetivo con semana opcional de descarga"
      >
        <form onSubmit={e => void handleSaveMesocycle(e)} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="lg:col-span-2 space-y-1">
              <label htmlFor="meso-name" className="text-xs font-medium text-ink-muted">
                Nombre del programa
              </label>
              <input
                id="meso-name"
                type="text"
                required
                value={mesoName}
                onChange={e => setMesoName(e.target.value)}
                className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="meso-goal" className="text-xs font-medium text-ink-muted">
                Objetivo
              </label>
              <select
                id="meso-goal"
                value={goal}
                onChange={e => setGoal(e.target.value as AthleteGoal)}
                className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
              >
                <option value="hipertrofia">Hipertrofia</option>
                <option value="fuerza">Fuerza Máxima</option>
                <option value="recomposicion">Recomposición</option>
                <option value="resistencia">Resistencia Muscular</option>
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="meso-days" className="text-xs font-medium text-ink-muted">
                Días / Semana
              </label>
              <select
                id="meso-days"
                value={daysPerWeek}
                onChange={e => setDaysPerWeek(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
              >
                {[2, 3, 4, 5, 6].map(d => (
                  <option key={d} value={d}>
                    {d} días/semana
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label htmlFor="meso-weeks" className="text-xs font-medium text-ink-muted">
                Duración
              </label>
              <select
                id="meso-weeks"
                value={durationWeeks}
                onChange={e => setDurationWeeks(Number(e.target.value) as MesocycleDurationWeeks)}
                className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
              >
                <option value={4}>4 semanas</option>
                <option value="6">6 semanas</option>
                <option value={8}>8 semanas</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-ink-muted">Nivel:</span>
              <select
                aria-label="Nivel de experiencia"
                value={experience}
                onChange={e => setExperience(e.target.value as TrainingExperience)}
                className="rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs text-ink"
              >
                <option value="principiante">Principiante</option>
                <option value="intermedio">Intermedio</option>
                <option value="avanzado">Avanzado</option>
              </select>

              <span className="text-xs font-medium text-ink-muted pl-2">Equipo:</span>
              {EQUIPMENT_OPTIONS.map(opt => {
                const checked = equipment.includes(opt.id);
                return (
                  <label key={opt.id} className="inline-flex items-center gap-1.5 text-xs text-ink cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleEquipment(opt.id)}
                      className="rounded border-border"
                    />
                    <span>{opt.label}</span>
                  </label>
                );
              })}
            </div>

            <label className="inline-flex items-center gap-2 text-xs font-medium text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={includeDeloadWeek}
                onChange={e => setIncludeDeloadWeek(e.target.checked)}
              />
              <span>Incluir semana final de descarga (Deload)</span>
            </label>
          </div>

          {/* Weekly progression preview */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            {previewProgram.mesocycleConfig?.weeks.map(w => (
              <div
                key={w.weekNumber}
                className={`rounded-lg border p-2.5 text-xs ${
                  w.isDeload ? 'border-info/40 bg-info-soft/40' : 'border-border bg-surface-alt/40'
                }`}
              >
                <div className="font-semibold text-ink">Sem {w.weekNumber}</div>
                <div className="text-[11px] text-ink-muted">
                  Vol ×{w.volumeMultiplier} · RIR {w.intensityRirTarget}
                </div>
                {w.isDeload && <div className="text-[11px] font-medium text-info mt-0.5">Descarga</div>}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center pt-1">
            <PayloadBudgetMeter bytes={previewBytes} label="Presupuesto documento WORKOUT_ROUTINE" />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingMeso}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-sm font-medium cursor-pointer"
              >
                <CalendarRange className="w-4 h-4" />
                <span>{savingMeso ? 'Guardando...' : 'Generar y Activar Mesociclo'}</span>
              </button>
            </div>
          </div>
        </form>
      </SectionCard>

      {/* Existing Routines */}
      <SectionCard
        title={`Rutinas Guardadas (${workspace.workoutRoutines.length})`}
        subtitle="Activa una rutina o inicia directamente cualquiera de sus sesiones"
      >
        {workspace.workoutRoutines.length === 0 ? (
          <StatePanel
            mode="empty"
            title="Sin rutinas configuradas"
            description="Genera un mesociclo arriba para empezar a registrar tus sesiones."
          />
        ) : (
          <div className="space-y-5">
            {workspace.workoutRoutines.map(routine => (
              <div key={routine.id} className="rounded-xl border border-border bg-surface-alt/30 p-4 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Dumbbell className="w-4 h-4 text-brand" />
                      <h3 className="text-base font-semibold text-ink">{routine.name}</h3>
                      {routine.isDefault && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-brand bg-brand-soft px-2 py-0.5 rounded">
                          <CheckCircle2 className="w-3 h-3" /> Activa
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-ink-muted mt-0.5">
                      {routine.description} · {routine.frequencyDays} días/sem · Objetivo: {routine.goal}
                    </p>
                  </div>
                  {!routine.isDefault && (
                    <button
                      type="button"
                      onClick={() => void setDefaultRoutine(routine.id)}
                      className="px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-alt text-xs font-medium text-ink cursor-pointer"
                    >
                      Marcar como Activa
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {routine.days.map(day => (
                    <div key={day.id} className="rounded-lg border border-border bg-surface p-3.5 space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-semibold text-ink">{day.name}</div>
                          <div className="text-xs text-ink-muted">{day.focusDescription}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleLaunchDay(routine.id, routine.name, day)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-medium cursor-pointer shrink-0"
                        >
                          <Play className="w-3.5 h-3.5" />
                          <span>{activeWorkout ? 'Ver activa' : 'Iniciar'}</span>
                        </button>
                      </div>

                      <div className="space-y-1 text-xs">
                        {day.exercises.map(ex => (
                          <div key={ex.id} className="flex items-center justify-between gap-2 text-ink-muted">
                            <span className="truncate text-ink">{ex.exerciseName}</span>
                            <span className="font-mono tabular-nums shrink-0">
                              {ex.sets} × {ex.repsMin}-{ex.repsMax} · RIR {ex.targetRir} · {ex.targetWeightKg}kg
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
};
