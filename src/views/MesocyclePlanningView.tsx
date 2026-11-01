/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Incremento 7B: Planificador y Generador Inteligente de Mesociclos
 *
 * Ofrece:
 *  1. Asistente en pasos cortos para generación asistida de mesociclos personalizados.
 *  2. Selección y recomendación explicable de estructura semanal.
 *  3. Vista previa completa e interactiva con navegación por semanas (cero escrituras).
 *  4. Editor en tiempo real de ejercicios y prescripciones antes de guardar.
 *  5. Guardado explícito y activación en Cloud Firestore o modo demo.
 *  6. Panel de seguimiento de cumplimiento, sesiones completadas y progreso semanal.
 */

import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { AthleteGoal, TrainingExperience } from '../types/auth';
import { EquipmentRequired, MuscleGroup, PlannedExerciseConfig, RoutineDay } from '../types/workout';
import {
  MesocycleDurationWeeks,
  SplitStructureId,
  MesocycleRoutine,
  MesocycleGenerationInput,
  MesocycleGenerationResult,
} from '../types/mesocycle';
import {
  SPLIT_STRUCTURES,
  getAvailableSplitStructures,
  recommendSplitStructure,
  generateMesocyclePlan,
} from '../services/mesocycleGeneratorService';
import { EXERCISE_CATALOG, getExerciseById } from '../data/exerciseCatalog';

export const MesocyclePlanningView: React.FC = () => {
  const {
    navigate,
    showToast,
    currentUser,
    athletePreferences,
    workoutRoutines,
    activeRoutine,
    activeRoutineId,
    setActiveRoutineId,
    saveMesocycleRoutine,
    advanceMesocycleWeek,
    startLiveWorkout,
    executedWorkoutsHistory,
    workoutHistory,
  } = useApp();

  // Active view tab: 'tracker' (Seguimiento del programa activo) vs 'generator' (Generador asistido)
  const [activeTab, setActiveTab] = useState<'tracker' | 'generator'>(() => {
    // Si la rutina activa ya es un mesociclo, abrir directamente en seguimiento
    const isCurrentMeso = activeRoutine && (activeRoutine as any).isMesocycle;
    return isCurrentMeso ? 'tracker' : 'generator';
  });

  // ========================================================
  // ESTADO DEL GENERADOR (3 PASOS CORTOS)
  // ========================================================
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);

  // Paso 1: Parámetros del Atleta
  const [goal, setGoal] = useState<AthleteGoal>(() => athletePreferences.trainingGoal || 'hipertrofia');
  const [experience, setExperience] = useState<TrainingExperience>(() => athletePreferences.trainingExperience || 'intermedio');
  const [daysPerWeek, setDaysPerWeek] = useState<number>(() => athletePreferences.daysPerWeek || athletePreferences.trainingDaysPerWeek || 4);
  const [sessionDuration, setSessionDuration] = useState<number>(() => athletePreferences.sessionDurationMinutes || 60);
  const [availableEquipment, setAvailableEquipment] = useState<EquipmentRequired[]>(() => {
    if (athletePreferences.equipmentType === 'mancuernas') return ['mancuerna', 'peso_corporal'];
    if (athletePreferences.equipmentType === 'calistenia') return ['peso_corporal'];
    if (athletePreferences.equipmentType === 'gimnasio_casero') return ['barra', 'mancuerna', 'peso_corporal'];
    return ['barra', 'mancuerna', 'polea', 'maquina', 'peso_corporal'];
  });

  // Paso 2: Estructura & Duración
  const [durationWeeks, setDurationWeeks] = useState<MesocycleDurationWeeks>(6);
  const [selectedSplitId, setSelectedSplitId] = useState<SplitStructureId>(() => {
    const rec = recommendSplitStructure(daysPerWeek, experience, goal);
    return rec.id;
  });
  const [includeDeload, setIncludeDeload] = useState<boolean>(true);
  const [customProgramName, setCustomProgramName] = useState<string>('');

  // Paso 3: Vista Previa del Mesociclo Generado (100% en memoria)
  const [generatedResult, setGeneratedResult] = useState<MesocycleGenerationResult | null>(null);
  const [previewWeekIndex, setPreviewWeekIndex] = useState<number>(1);
  const [previewDayId, setPreviewDayId] = useState<string>('d1');
  const [activateOnSave, setActivateOnSave] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Tracker State: visualización de semana específica en el mesociclo activo
  const activeMesocycle = useMemo<MesocycleRoutine | null>(() => {
    if (activeRoutine && (activeRoutine as any).isMesocycle && (activeRoutine as any).mesocycleConfig) {
      return activeRoutine as MesocycleRoutine;
    }
    // Buscar si hay algún mesociclo en la lista de rutinas
    const found = workoutRoutines.find(r => (r as any).isMesocycle);
    return found ? (found as MesocycleRoutine) : null;
  }, [activeRoutine, workoutRoutines]);

  const [trackerSelectedWeek, setTrackerSelectedWeek] = useState<number>(() => {
    return activeMesocycle?.mesocycleConfig?.currentWeek || 1;
  });

  // ========================================================
  // RECOMENDACIÓN DINÁMICA DE ESTRUCTURA
  // ========================================================
  const recommendedSplit = useMemo(() => {
    return recommendSplitStructure(daysPerWeek, experience, goal);
  }, [daysPerWeek, experience, goal]);

  const availableSplitsForDays = useMemo(() => {
    return getAvailableSplitStructures(daysPerWeek);
  }, [daysPerWeek]);

  // Actualizar la estructura recomendada si cambia el número de días
  const handleDaysChange = (newDays: number) => {
    setDaysPerWeek(newDays);
    const rec = recommendSplitStructure(newDays, experience, goal);
    setSelectedSplitId(rec.id);
  };

  const toggleEquipment = (eq: EquipmentRequired) => {
    setAvailableEquipment(prev =>
      prev.includes(eq) ? prev.filter(e => e !== eq) : [...prev, eq]
    );
  };

  // ========================================================
  // ACCIONES DEL GENERADOR
  // ========================================================
  const handleGeneratePreview = () => {
    if (availableEquipment.length === 0) {
      showToast('Por favor selecciona al menos un tipo de equipamiento disponible', 'warning');
      return;
    }

    const input: MesocycleGenerationInput = {
      name: customProgramName.trim() || undefined,
      athleteGoal: goal,
      experience,
      daysPerWeek,
      targetSessionDurationMinutes: sessionDuration,
      availableEquipment,
      durationWeeks,
      splitStructure: selectedSplitId,
      includeDeloadWeek: includeDeload,
    };

    const result = generateMesocyclePlan(input, executedWorkoutsHistory, workoutHistory);
    setGeneratedResult(result);
    setPreviewWeekIndex(1);
    setPreviewDayId(result.program.days[0]?.id || 'd1');
    setWizardStep(3);
    showToast('¡Vista previa del mesociclo generada con éxito!', 'success');
  };

  const handleSaveAndActivate = async () => {
    if (!generatedResult) return;
    setIsSaving(true);
    try {
      const routineId = await saveMesocycleRoutine(generatedResult.program, activateOnSave);
      showToast('Mesociclo planificado guardado y activado correctamente', 'success');
      setActiveTab('tracker');
      setTrackerSelectedWeek(1);
    } catch (e: any) {
      console.error('Error al guardar mesociclo:', e);
      showToast(`Error al guardar: ${e.message || 'Error de red'}`, 'warning');
    } finally {
      setIsSaving(false);
    }
  };

  // Reemplazo de ejercicio en la vista previa interactiva
  const handleReplaceExerciseInPreview = (dayId: string, configId: string, newExerciseId: string) => {
    if (!generatedResult) return;
    const newExItem = getExerciseById(newExerciseId);
    if (!newExItem) return;

    const updatedProgram: MesocycleRoutine = {
      ...generatedResult.program,
      days: generatedResult.program.days.map(d => {
        if (d.id === dayId) {
          return {
            ...d,
            exercises: d.exercises.map(ex => {
              if (ex.id === configId) {
                return {
                  ...ex,
                  exerciseId: newExerciseId,
                  notes: `Sustituido manualmente por ${newExItem.name}.`,
                };
              }
              return ex;
            }),
          };
        }
        return d;
      }),
      mesocycleConfig: {
        ...generatedResult.program.mesocycleConfig,
        weeks: generatedResult.program.mesocycleConfig.weeks.map(week => ({
          ...week,
          days: week.days.map(d => {
            if (d.id === dayId) {
              return {
                ...d,
                exercises: d.exercises.map(ex => {
                  if (ex.id === configId) {
                    return {
                      ...ex,
                      exerciseId: newExerciseId,
                    };
                  }
                  return ex;
                }),
              };
            }
            return d;
          }),
        })),
      },
    };

    setGeneratedResult({
      ...generatedResult,
      program: updatedProgram,
    });
    showToast(`Ejercicio actualizado a: ${newExItem.name}`, 'info');
  };

  // ========================================================
  // RENDER: PESTAÑA DE SEGUIMIENTO (TRACKER)
  // ========================================================
  const renderTracker = () => {
    if (!activeMesocycle || !activeMesocycle.mesocycleConfig) {
      return (
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-8 text-center max-w-2xl mx-auto my-8">
          <div className="w-16 h-16 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-stone-100 mb-2">No tienes un mesociclo activo seleccionado</h3>
          <p className="text-stone-400 text-sm mb-6 leading-relaxed">
            Un mesociclo estructurado te permite programar semanas de sobrecarga progresiva (calibración, progresión de repeticiones, micro-cargas y descarga planificada) basadas en tu perfil de atleta.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={() => {
                setActiveTab('generator');
                setWizardStep(1);
              }}
              className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-lg text-sm transition-colors shadow-lg shadow-amber-500/10"
            >
              Generar mi Primer Mesociclo Asistido
            </button>
            <button
              onClick={() => navigate('rutina-de-entrenamiento')}
              className="px-5 py-2.5 bg-stone-800 hover:bg-stone-700 text-stone-200 font-semibold rounded-lg text-sm transition-colors border border-stone-700"
            >
              Ver Rutinas Clásicas
            </button>
          </div>
        </div>
      );
    }

    const { mesocycleConfig } = activeMesocycle;
    const currentWeekNum = mesocycleConfig.currentWeek || 1;
    const totalWeeks = mesocycleConfig.durationWeeks;
    const completedList = mesocycleConfig.completedSessions || [];

    // Calcular estadísticas globales
    const totalSessionsInProgram = mesocycleConfig.weeks.reduce((acc, w) => acc + w.days.length, 0);
    const totalCompletedCount = completedList.length;
    const compliancePercent = totalSessionsInProgram > 0
      ? Math.round((totalCompletedCount / totalSessionsInProgram) * 100)
      : 0;

    // Obtener la semana seleccionada en el visor
    const viewedWeek = mesocycleConfig.weeks.find(w => w.weekNumber === trackerSelectedWeek) || mesocycleConfig.weeks[0];

    return (
      <div className="space-y-6">
        {/* Cabecera del Mesociclo Activo */}
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-stone-800">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="bg-amber-500/10 text-amber-500 border border-amber-500/30 text-xs px-2.5 py-0.5 rounded-md font-semibold uppercase tracking-wider">
                  Mesociclo Activo
                </span>
                <span className="text-stone-400 text-xs">
                  • {mesocycleConfig.splitStructureName} • {totalWeeks} Semanas
                </span>
              </div>
              <h2 className="text-2xl font-bold text-stone-100">{activeMesocycle.name}</h2>
              <p className="text-stone-400 text-sm mt-1">{activeMesocycle.description}</p>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  setActiveTab('generator');
                  setWizardStep(1);
                }}
                className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 rounded-lg text-xs font-semibold transition-colors"
              >
                + Diseñar Nuevo Mesociclo
              </button>
            </div>
          </div>

          {/* Métricas de Adherencia y Progreso */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-6">
            <div className="bg-stone-950/60 border border-stone-850 p-4 rounded-lg">
              <p className="text-xs text-stone-400 font-medium">Semana Actual</p>
              <p className="text-2xl font-bold text-amber-500 mt-1">
                {currentWeekNum} <span className="text-sm font-normal text-stone-500">de {totalWeeks}</span>
              </p>
              <p className="text-xs text-stone-400 mt-1">
                {currentWeekNum === totalWeeks && mesocycleConfig.hasDeloadWeek ? 'Semana de Descarga' : 'Fase de Sobrecarga'}
              </p>
            </div>

            <div className="bg-stone-950/60 border border-stone-850 p-4 rounded-lg">
              <p className="text-xs text-stone-400 font-medium">Cumplimiento Global</p>
              <p className="text-2xl font-bold text-emerald-400 mt-1">{compliancePercent}%</p>
              <div className="w-full bg-stone-800 h-1.5 rounded-full mt-2 overflow-hidden">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                  style={{ width: `${compliancePercent}%` }}
                />
              </div>
            </div>

            <div className="bg-stone-950/60 border border-stone-850 p-4 rounded-lg">
              <p className="text-xs text-stone-400 font-medium">Sesiones Completadas</p>
              <p className="text-2xl font-bold text-stone-100 mt-1">
                {totalCompletedCount} <span className="text-sm font-normal text-stone-500">de {totalSessionsInProgram}</span>
              </p>
              <p className="text-xs text-stone-400 mt-1">Verificadas con registro en vivo</p>
            </div>

            <div className="bg-stone-950/60 border border-stone-850 p-4 rounded-lg">
              <p className="text-xs text-stone-400 font-medium">Frecuencia Semanal</p>
              <p className="text-2xl font-bold text-stone-100 mt-1">
                {activeMesocycle.frequencyDays} <span className="text-sm font-normal text-stone-500">días/sem</span>
              </p>
              <p className="text-xs text-stone-400 mt-1">Objetivo: {mesocycleConfig.athleteGoal}</p>
            </div>
          </div>
        </div>

        {/* Navegador de Semanas */}
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
            <div>
              <h3 className="text-lg font-bold text-stone-100">Explorador de Semanas del Mesociclo</h3>
              <p className="text-stone-400 text-xs mt-0.5">
                Navega entre las semanas para consultar la evolución de cargas, RIR prescrito y sesiones pendientes.
              </p>
            </div>

            {/* Selector de Semanas Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {mesocycleConfig.weeks.map(w => {
                const isSelected = w.weekNumber === trackerSelectedWeek;
                const isCurrent = w.weekNumber === currentWeekNum;
                const weekDone = w.days.every(d =>
                  completedList.some(c => c.weekNumber === w.weekNumber && c.dayId === d.id)
                );

                return (
                  <button
                    key={w.weekNumber}
                    onClick={() => setTrackerSelectedWeek(w.weekNumber)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all border ${
                      isSelected
                        ? 'bg-amber-500 text-stone-950 border-amber-500 shadow-sm'
                        : isCurrent
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        : 'bg-stone-800 text-stone-300 border-stone-700 hover:bg-stone-750'
                    }`}
                  >
                    Sem {w.weekNumber}
                    {w.isDeload ? ' (Descarga)' : ''}
                    {weekDone ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Banner de la semana seleccionada */}
          <div className="bg-stone-950 border border-stone-800 rounded-lg p-4 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-stone-200 font-bold text-base">{viewedWeek.name}</span>
                {viewedWeek.isDeload && (
                  <span className="bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs px-2 py-0.5 rounded-md font-medium">
                    Descarga Activa
                  </span>
                )}
                {viewedWeek.weekNumber === currentWeekNum && (
                  <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs px-2 py-0.5 rounded-md font-medium">
                    Semana en Curso
                  </span>
                )}
              </div>
              <p className="text-stone-400 text-xs mt-1 leading-relaxed">{viewedWeek.focus}</p>
            </div>

            {viewedWeek.weekNumber !== currentWeekNum && (
              <button
                onClick={() => advanceMesocycleWeek(activeMesocycle.id, viewedWeek.weekNumber)}
                className="px-3.5 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap"
              >
                Fijar como Semana Activa
              </button>
            )}
          </div>

          {/* Lista de Sesiones de la Semana Seleccionada */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {viewedWeek.days.map((day, dIdx) => {
              const isCompleted = completedList.some(
                c => c.weekNumber === viewedWeek.weekNumber && c.dayId === day.id
              );
              const completedRecord = completedList.find(
                c => c.weekNumber === viewedWeek.weekNumber && c.dayId === day.id
              );

              return (
                <div
                  key={day.id}
                  className={`border rounded-xl p-5 transition-all ${
                    isCompleted
                      ? 'bg-stone-900/60 border-emerald-500/30'
                      : 'bg-stone-900 border-stone-800 hover:border-stone-700'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-amber-500 uppercase tracking-wide">
                          Sesión {dIdx + 1}
                        </span>
                        {isCompleted ? (
                          <span className="bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs px-2 py-0.5 rounded-md font-semibold">
                            ✓ Completada
                          </span>
                        ) : (
                          <span className="bg-stone-800 text-stone-400 text-xs px-2 py-0.5 rounded-md font-medium">
                            Pendiente
                          </span>
                        )}
                      </div>
                      <h4 className="text-base font-bold text-stone-100 mt-1">{day.name}</h4>
                      <p className="text-stone-400 text-xs mt-0.5">{day.focusDescription}</p>
                    </div>
                  </div>

                  {/* Ejercicios del Día */}
                  <div className="bg-stone-950/70 rounded-lg p-3 space-y-2 mb-4 border border-stone-850">
                    {day.exercises.map((cfg, exIdx) => {
                      const exItem = getExerciseById(cfg.exerciseId);
                      return (
                        <div
                          key={cfg.id}
                          className="flex items-center justify-between text-xs py-1 border-b border-stone-850/60 last:border-0"
                        >
                          <span className="text-stone-300 font-medium truncate max-w-[200px]">
                            {exIdx + 1}. {exItem?.name || cfg.exerciseId}
                          </span>
                          <span className="text-stone-400 font-mono">
                            {cfg.sets} × {cfg.repsMin}-{cfg.repsMax} • RIR {cfg.targetRir}
                            {cfg.targetWeightKg && cfg.targetWeightKg > 0 ? ` @ ${cfg.targetWeightKg}kg` : ''}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Botón de Acción */}
                  <div className="flex items-center justify-between pt-2">
                    {isCompleted ? (
                      <span className="text-xs text-stone-400">
                        Completada el {completedRecord?.completedAt ? new Date(completedRecord.completedAt).toLocaleDateString('es-ES') : 'Reciente'}
                      </span>
                    ) : (
                      <button
                        onClick={async () => {
                          showToast(`Iniciando ${day.name} en vivo...`, 'info');
                          await startLiveWorkout(activeMesocycle, day);
                        }}
                        className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-lg text-xs transition-colors flex items-center justify-center gap-2 shadow-sm"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Iniciar Sesión en Vivo
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  // ========================================================
  // RENDER: GENERADOR ASISTIDO EN 3 PASOS
  // ========================================================
  const renderGenerator = () => {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Barra de Pasos del Asistente */}
        <div className="bg-stone-900 border border-stone-800 rounded-xl p-4">
          <div className="grid grid-cols-3 gap-2">
            {[
              { num: 1, title: '1. Parámetros del Atleta' },
              { num: 2, title: '2. Estructura & Duración' },
              { num: 3, title: '3. Vista Previa & Ajustes' },
            ].map(s => {
              const isActive = wizardStep === s.num;
              const isPast = wizardStep > s.num;
              return (
                <div
                  key={s.num}
                  className={`p-3 rounded-lg border text-center transition-all ${
                    isActive
                      ? 'bg-amber-500/10 border-amber-500/40 text-amber-400 font-bold'
                      : isPast
                      ? 'bg-stone-950 border-stone-800 text-stone-300 font-medium'
                      : 'bg-stone-950/40 border-stone-850 text-stone-500 font-normal'
                  }`}
                >
                  <span className="text-xs">{s.title}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* PASO 1: PARÁMETROS DEL ATLETA */}
        {wizardStep === 1 && (
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-6 space-y-6">
            <div>
              <h3 className="text-xl font-bold text-stone-100">Parámetros & Disponibilidad de Entrenamiento</h3>
              <p className="text-stone-400 text-xs mt-1">
                Ajusta tus preferencias reales para que el motor diseñe una estructura perfectamente adaptada a tu tiempo y equipamiento.
              </p>
            </div>

            {/* Objetivo */}
            <div>
              <label className="block text-xs font-semibold text-stone-300 mb-2 uppercase tracking-wider">
                Objetivo Principal
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {[
                  { id: 'hipertrofia', label: 'Hipertrofia', desc: 'Masa muscular & bombeo' },
                  { id: 'fuerza', label: 'Fuerza Máxima', desc: 'Cargas altas & tensión mecánica' },
                  { id: 'recomposicion', label: 'Recomposición', desc: 'Grasa baja & tono magro' },
                  { id: 'definicion', label: 'Definición', desc: 'Mantener músculo con déficit' },
                  { id: 'mantenimiento', label: 'Mantenimiento', desc: 'Salud articular & constancia' },
                ].map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setGoal(opt.id as AthleteGoal)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      goal === opt.id
                        ? 'bg-amber-500/10 border-amber-500 text-amber-300'
                        : 'bg-stone-950 border-stone-800 text-stone-400 hover:border-stone-700'
                    }`}
                  >
                    <p className="font-bold text-xs">{opt.label}</p>
                    <p className="text-[11px] text-stone-500 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Experiencia y Días */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-stone-300 mb-2 uppercase tracking-wider">
                  Nivel de Experiencia
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'principiante', label: 'Principiante' },
                    { id: 'intermedio', label: 'Intermedio' },
                    { id: 'avanzado', label: 'Avanzado' },
                  ].map(exp => (
                    <button
                      key={exp.id}
                      type="button"
                      onClick={() => setExperience(exp.id as TrainingExperience)}
                      className={`py-2 px-3 rounded-lg border text-xs font-semibold text-center transition-all ${
                        experience === exp.id
                          ? 'bg-amber-500/10 border-amber-500 text-amber-300'
                          : 'bg-stone-950 border-stone-800 text-stone-400 hover:border-stone-700'
                      }`}
                    >
                      {exp.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-stone-300 mb-2 uppercase tracking-wider">
                  Días Disponibles por Semana
                </label>
                <div className="grid grid-cols-5 gap-1.5">
                  {[2, 3, 4, 5, 6].map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => handleDaysChange(d)}
                      className={`py-2 rounded-lg border text-xs font-bold text-center transition-all ${
                        daysPerWeek === d
                          ? 'bg-amber-500 text-stone-950 border-amber-500 font-extrabold'
                          : 'bg-stone-950 border-stone-800 text-stone-300 hover:border-stone-700'
                      }`}
                    >
                      {d} días
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Duración por sesión */}
            <div>
              <label className="block text-xs font-semibold text-stone-300 mb-2 uppercase tracking-wider">
                Tiempo Objetivo por Sesión: <span className="text-amber-400 font-bold">{sessionDuration} minutos</span>
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min="40"
                  max="100"
                  step="5"
                  value={sessionDuration}
                  onChange={e => setSessionDuration(Number(e.target.value))}
                  className="w-full accent-amber-500 bg-stone-800 rounded-lg h-2 cursor-pointer"
                />
              </div>
              <div className="flex justify-between text-[11px] text-stone-500 mt-1">
                <span>40 min (Rápido)</span>
                <span>60 min (Estándar)</span>
                <span>90+ min (Alto volumen)</span>
              </div>
            </div>

            {/* Equipamiento disponible */}
            <div>
              <label className="block text-xs font-semibold text-stone-300 mb-2 uppercase tracking-wider">
                Equipamiento Disponible en tu Espacio
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'barra', label: 'Barra & Discos' },
                  { id: 'mancuerna', label: 'Mancuernas' },
                  { id: 'polea', label: 'Poleas / Cables' },
                  { id: 'maquina', label: 'Máquinas Guiadas' },
                  { id: 'peso_corporal', label: 'Peso Corporal' },
                  { id: 'kettlebell', label: 'Kettlebells' },
                  { id: 'bandas', label: 'Bandas Elásticas' },
                ].map(eq => {
                  const isChecked = availableEquipment.includes(eq.id as EquipmentRequired);
                  return (
                    <button
                      key={eq.id}
                      type="button"
                      onClick={() => toggleEquipment(eq.id as EquipmentRequired)}
                      className={`p-2.5 rounded-lg border text-left text-xs font-semibold transition-all flex items-center justify-between ${
                        isChecked
                          ? 'bg-amber-500/10 border-amber-500 text-amber-300'
                          : 'bg-stone-950 border-stone-800 text-stone-500 hover:border-stone-700'
                      }`}
                    >
                      <span>{eq.label}</span>
                      <span>{isChecked ? '✓' : '+'}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setWizardStep(2)}
                className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-lg text-sm transition-colors shadow-sm"
              >
                Continuar a Estructura & Duración →
              </button>
            </div>
          </div>
        )}

        {/* PASO 2: ESTRUCTURA & DURACIÓN */}
        {wizardStep === 2 && (
          <div className="bg-stone-900 border border-stone-800 rounded-xl p-6 space-y-6">
            <div>
              <h3 className="text-xl font-bold text-stone-100">Estructura Semanal & Periodización</h3>
              <p className="text-stone-400 text-xs mt-1">
                Selecciona la distribución biomecánica y la duración del bloque de entrenamiento.
              </p>
            </div>

            {/* Duración del Mesociclo */}
            <div>
              <label className="block text-xs font-semibold text-stone-300 mb-2 uppercase tracking-wider">
                Duración del Mesociclo
              </label>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { weeks: 4, label: '4 Semanas', desc: 'Bloque corto & calibración rápida' },
                  { weeks: 6, label: '6 Semanas (Recomendado)', desc: 'Acumulación y sobrecarga óptima' },
                  { weeks: 8, label: '8 Semanas', desc: 'Mesociclo extendido para avanzados' },
                ].map(item => (
                  <button
                    key={item.weeks}
                    type="button"
                    onClick={() => setDurationWeeks(item.weeks as MesocycleDurationWeeks)}
                    className={`p-3 rounded-lg border text-left transition-all ${
                      durationWeeks === item.weeks
                        ? 'bg-amber-500/10 border-amber-500 text-amber-300'
                        : 'bg-stone-950 border-stone-800 text-stone-400 hover:border-stone-700'
                    }`}
                  >
                    <p className="font-bold text-xs">{item.label}</p>
                    <p className="text-[11px] text-stone-500 mt-0.5">{item.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Selector de División Semanal */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-xs font-semibold text-stone-300 uppercase tracking-wider">
                  División Semanal para {daysPerWeek} días
                </label>
                <span className="text-[11px] text-amber-400 font-semibold">
                  Sugerida: {recommendedSplit.name}
                </span>
              </div>

              <div className="space-y-2.5">
                {availableSplitsForDays.map(split => {
                  const isSelected = selectedSplitId === split.id;
                  const isRec = recommendedSplit.id === split.id;

                  return (
                    <div
                      key={split.id}
                      onClick={() => setSelectedSplitId(split.id)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-stone-950 border-amber-500 ring-1 ring-amber-500/20'
                          : 'bg-stone-950 border-stone-800 hover:border-stone-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-sm text-stone-100">{split.name}</h4>
                            {isRec && (
                              <span className="bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[10px] px-2 py-0.5 rounded-md font-semibold">
                                Recomendada para tu perfil
                              </span>
                            )}
                          </div>
                          <p className="text-stone-400 text-xs mt-1 leading-relaxed">{split.description}</p>
                          <p className="text-stone-500 text-[11px] mt-1.5 italic">
                            Por qué: {split.rationale}
                          </p>
                        </div>
                        <input
                          type="radio"
                          name="splitSelection"
                          checked={isSelected}
                          onChange={() => setSelectedSplitId(split.id)}
                          className="mt-1 accent-amber-500"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Descarga planificada */}
            <div className="bg-stone-950 border border-stone-800 rounded-lg p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-bold text-stone-200">Incluir Semana de Descarga Planificada (Deload)</p>
                <p className="text-stone-400 text-[11px] mt-0.5">
                  La semana final (Semana {durationWeeks}) reducirá el volumen de series un 35% y fijará un RIR 4 para regeneración neuromuscular.
                </p>
              </div>
              <input
                type="checkbox"
                checked={includeDeload}
                onChange={e => setIncludeDeload(e.target.checked)}
                className="w-5 h-5 accent-amber-500 rounded cursor-pointer"
              />
            </div>

            {/* Nombre opcional */}
            <div>
              <label className="block text-xs font-semibold text-stone-300 mb-1.5 uppercase tracking-wider">
                Nombre Personalizado del Programa (Opcional)
              </label>
              <input
                type="text"
                value={customProgramName}
                onChange={e => setCustomProgramName(e.target.value)}
                placeholder={`Mesociclo ${goal.charAt(0).toUpperCase() + goal.slice(1)} (${durationWeeks} Semanas)`}
                className="w-full bg-stone-950 border border-stone-800 rounded-lg px-3.5 py-2.5 text-xs text-stone-200 focus:outline-none focus:border-amber-500"
              />
            </div>

            <div className="pt-4 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setWizardStep(1)}
                className="px-4 py-2 bg-stone-800 hover:bg-stone-700 text-stone-300 rounded-lg text-xs font-semibold transition-colors"
              >
                ← Volver a Parámetros
              </button>
              <button
                type="button"
                onClick={handleGeneratePreview}
                className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-lg text-sm transition-colors shadow-sm"
              >
                Generar Vista Previa del Mesociclo →
              </button>
            </div>
          </div>
        )}

        {/* PASO 3: VISTA PREVIA & EDITOR INTERACTIVO */}
        {wizardStep === 3 && generatedResult && (
          <div className="space-y-6">
            {/* Tarjeta de Resumen General */}
            <div className="bg-stone-900 border border-stone-800 rounded-xl p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-stone-800">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="bg-amber-500/10 text-amber-500 border border-amber-500/30 text-xs px-2.5 py-0.5 rounded-md font-semibold uppercase tracking-wider">
                      Vista Previa (Cero Escrituras en DB)
                    </span>
                    <span className="text-stone-400 text-xs">
                      • {generatedResult.program.mesocycleConfig.durationWeeks} Semanas • {generatedResult.program.frequencyDays} Días/Sem
                    </span>
                  </div>
                  <h3 className="text-2xl font-bold text-stone-100">{generatedResult.program.name}</h3>
                  <p className="text-stone-400 text-xs mt-1">{generatedResult.program.description}</p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setWizardStep(2)}
                    className="px-3.5 py-2 bg-stone-800 hover:bg-stone-700 text-stone-300 border border-stone-700 rounded-lg text-xs font-semibold transition-colors"
                  >
                    ← Modificar Estructura
                  </button>
                  <button
                    onClick={handleSaveAndActivate}
                    disabled={isSaving}
                    className="px-6 py-2.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-lg text-sm transition-colors shadow-lg shadow-amber-500/10 flex items-center gap-2 disabled:opacity-50"
                  >
                    {isSaving ? 'Guardando en la Nube...' : 'Confirmar & Guardar Mesociclo'}
                  </button>
                </div>
              </div>

              {/* Justificaciones y Advertencias */}
              {generatedResult.warnings.length > 0 && (
                <div className="mt-4 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-300 space-y-1">
                  <p className="font-bold flex items-center gap-1.5">
                    <span>⚠️</span> Observaciones de compatibilidad:
                  </p>
                  {generatedResult.warnings.map((w, idx) => (
                    <p key={idx} className="text-stone-300 text-[11px] leading-relaxed">
                      • {w}
                    </p>
                  ))}
                </div>
              )}

              {/* Checkbox de Activación Inmediata */}
              <div className="mt-4 flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="activateOnSave"
                  checked={activateOnSave}
                  onChange={e => setActivateOnSave(e.target.checked)}
                  className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                />
                <label htmlFor="activateOnSave" className="text-xs text-stone-300 cursor-pointer">
                  Fijar este programa como mi rutina activa de entrenamiento inmediatamente después de guardar
                </label>
              </div>
            </div>

            {/* Explorador de Semanas en la Vista Previa */}
            <div className="bg-stone-900 border border-stone-800 rounded-xl p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h4 className="text-base font-bold text-stone-100">Progresión Semana a Semana</h4>
                  <p className="text-stone-400 text-xs">
                    Revisa cómo evolucionan el volumen, las repeticiones y la intensidad a lo largo del bloque.
                  </p>
                </div>

                {/* Tabs de Semanas */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                  {generatedResult.program.mesocycleConfig.weeks.map(w => (
                    <button
                      key={w.weekNumber}
                      onClick={() => {
                        setPreviewWeekIndex(w.weekNumber);
                        setPreviewDayId(w.days[0]?.id || 'd1');
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap border transition-all ${
                        previewWeekIndex === w.weekNumber
                          ? 'bg-amber-500 text-stone-950 border-amber-500'
                          : 'bg-stone-950 text-stone-400 border-stone-800 hover:border-stone-700'
                      }`}
                    >
                      Semana {w.weekNumber} {w.isDeload ? '(Descarga)' : ''}
                    </button>
                  ))}
                </div>
              </div>

              {/* Detalle de la semana visualizada */}
              {(() => {
                const currentWeek =
                  generatedResult.program.mesocycleConfig.weeks.find(w => w.weekNumber === previewWeekIndex) ||
                  generatedResult.program.mesocycleConfig.weeks[0];

                const currentDay = currentWeek.days.find(d => d.id === previewDayId) || currentWeek.days[0];

                return (
                  <div className="space-y-4">
                    {/* Header de la semana */}
                    <div className="bg-stone-950 border border-stone-850 rounded-lg p-3 flex items-center justify-between">
                      <div>
                        <span className="text-xs font-bold text-amber-400">{currentWeek.name}</span>
                        <p className="text-[11px] text-stone-400 mt-0.5">{currentWeek.focus}</p>
                      </div>
                      <span className="text-xs font-mono text-stone-400">
                        RIR Prescrito: <strong className="text-stone-200">{currentWeek.intensityRirTarget}</strong>
                      </span>
                    </div>

                    {/* Selector de días de la semana */}
                    <div className="flex items-center gap-2 overflow-x-auto border-b border-stone-800 pb-2">
                      {currentWeek.days.map((d, idx) => (
                        <button
                          key={d.id}
                          onClick={() => setPreviewDayId(d.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                            previewDayId === d.id
                              ? 'bg-stone-800 text-amber-400 border border-amber-500/30'
                              : 'text-stone-400 hover:text-stone-200'
                          }`}
                        >
                          Día {idx + 1}: {d.shortName}
                        </button>
                      ))}
                    </div>

                    {/* Tabla de Ejercicios del Día */}
                    <div className="space-y-2">
                      {currentDay.exercises.map((cfg, exIdx) => {
                        const exItem = getExerciseById(cfg.exerciseId);
                        return (
                          <div
                            key={cfg.id}
                            className="bg-stone-950 border border-stone-850 rounded-lg p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-amber-500 font-mono font-bold text-xs">{exIdx + 1}.</span>
                                <span className="font-bold text-xs text-stone-200">{exItem?.name || cfg.exerciseId}</span>
                                <span className="text-[10px] text-stone-500 uppercase bg-stone-900 px-1.5 py-0.5 rounded">
                                  {exItem?.equipment}
                                </span>
                              </div>
                              <p className="text-[11px] text-stone-400 mt-1 pl-4">
                                {cfg.notes || exItem?.instructions?.[0] || 'Técnica estricta y control excéntrico.'}
                              </p>
                            </div>

                            <div className="flex items-center gap-4 text-xs font-mono text-stone-300">
                              <div className="text-right">
                                <p className="font-bold text-amber-400">
                                  {cfg.sets} series × {cfg.repsMin}-{cfg.repsMax} reps
                                </p>
                                <p className="text-[11px] text-stone-500">
                                  RIR {cfg.targetRir} • Descanso {cfg.restSeconds}s
                                </p>
                              </div>

                              {/* Sustitución rápida por variante compatible */}
                              {exItem?.variants && exItem.variants.length > 0 && (
                                <select
                                  onChange={e => {
                                    if (e.target.value && e.target.value !== cfg.exerciseId) {
                                      handleReplaceExerciseInPreview(currentDay.id, cfg.id, e.target.value);
                                    }
                                  }}
                                  value={cfg.exerciseId}
                                  className="bg-stone-900 border border-stone-800 text-[11px] text-stone-300 rounded px-2 py-1 focus:outline-none"
                                >
                                  <option value={cfg.exerciseId}>Sustituir variante...</option>
                                  {exItem.variants.map(vId => {
                                    const vItem = getExerciseById(vId);
                                    return (
                                      <option key={vId} value={vId}>
                                        {vItem?.name || vId}
                                      </option>
                                    );
                                  })}
                                </select>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Encabezado Superior de Navegación */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-stone-800">
        <div>
          <h1 className="text-3xl font-extrabold text-stone-100 tracking-tight">Planificador & Mesociclos</h1>
          <p className="text-stone-400 text-sm mt-1">
            Periodización científica de fuerza, sobrecarga progresiva asistida y seguimiento de cumplimiento.
          </p>
        </div>

        {/* Pestañas Principales */}
        <div className="flex items-center gap-1 bg-stone-900 border border-stone-800 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('tracker')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'tracker'
                ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            Seguimiento Activo
          </button>
          <button
            onClick={() => setActiveTab('generator')}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'generator'
                ? 'bg-amber-500 text-stone-950 font-bold shadow-sm'
                : 'text-stone-400 hover:text-stone-200'
            }`}
          >
            Generador Asistido
          </button>
        </div>
      </div>

      {/* Contenido según pestaña activa */}
      {activeTab === 'tracker' ? renderTracker() : renderGenerator()}
    </div>
  );
};
