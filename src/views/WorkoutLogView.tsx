import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { WorkoutSetType, LiveExerciseSession } from '../types/workout';
import { calculateEpley1RM } from '../utils/workoutCalculations';

export const WorkoutLogView: React.FC = () => {
  const {
    showToast,
    navigate,
    activeLiveWorkout,
    commitLiveSet,
    addExtraLiveSet,
    finishLiveWorkout,
    abandonLiveWorkout,
    hasRecoveredLiveSession,
    resumeRecoveredLiveSession,
    discardRecoveredLiveSession,
    updateLiveSessionDuration,
    startQuickLiveWorkout,
    startLiveWorkout,
    activeRoutine,
    restTimerSeconds,
    adjustRestTimer,
    resetRestTimer,
    toggleRestTimer,
    isRestTimerRunning,
    isDemoMode,
  } = useApp();

  // Selected exercise within the active live workout
  const [selectedExerciseIndex, setSelectedExerciseIndex] = useState(0);

  // Active working set tactile input states
  const [currentWeight, setCurrentWeight] = useState<number>(75.0);
  const [currentReps, setCurrentReps] = useState<number>(8);
  const [selectedRir, setSelectedRir] = useState<number>(2);
  const [selectedSetType, setSelectedSetType] = useState<WorkoutSetType>('effective');
  const [isSubmittingSet, setIsSubmittingSet] = useState(false);

  // Elapsed Session Timer
  const [sessionSeconds, setSessionSeconds] = useState(activeLiveWorkout?.durationSeconds || 0);
  const [isSessionPaused, setIsSessionPaused] = useState(false);

  // Collapsible cards & Modals
  const [expandedExerciseIndex, setExpandedExerciseIndex] = useState<number | null>(null);
  const [isFinishModalOpen, setIsFinishModalOpen] = useState(false);
  const [isAbandonModalOpen, setIsAbandonModalOpen] = useState(false);
  const [postWorkoutNotes, setPostWorkoutNotes] = useState('');
  const [postWorkoutRpe, setPostWorkoutRpe] = useState(8.5);

  // Quick 1RM Calculator State
  const [calcWeight, setCalcWeight] = useState(75);
  const [calcReps, setCalcReps] = useState(7);

  // Dynamic active exercise
  const currentExercise: LiveExerciseSession | null = useMemo(() => {
    if (!activeLiveWorkout || activeLiveWorkout.exercisesSnapshot.length === 0) return null;
    return activeLiveWorkout.exercisesSnapshot[selectedExerciseIndex] || activeLiveWorkout.exercisesSnapshot[0];
  }, [activeLiveWorkout, selectedExerciseIndex]);

  // Next incomplete set for current exercise
  const nextIncompleteSet = useMemo(() => {
    if (!currentExercise) return null;
    return currentExercise.sets.find(s => !s.completed) || null;
  }, [currentExercise]);

  // Sync working inputs with next incomplete set target values when switching exercises or completing a set
  useEffect(() => {
    if (nextIncompleteSet) {
      if (nextIncompleteSet.weightKg > 0) {
        setCurrentWeight(nextIncompleteSet.weightKg);
      }
      if (nextIncompleteSet.reps > 0) {
        setCurrentReps(nextIncompleteSet.reps);
      }
      if (nextIncompleteSet.targetRir !== undefined) {
        setSelectedRir(nextIncompleteSet.targetRir);
      }
      setSelectedSetType(nextIncompleteSet.type || 'effective');
    }
  }, [nextIncompleteSet, selectedExerciseIndex]);

  // Elapsed session timer loop
  useEffect(() => {
    if (!activeLiveWorkout) return;
    let interval: any;
    if (!isSessionPaused) {
      interval = setInterval(() => {
        setSessionSeconds(prev => {
          const next = prev + 1;
          // Periodically sync duration back
          if (next % 30 === 0) {
            updateLiveSessionDuration(next);
          }
          return next;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isSessionPaused, activeLiveWorkout, updateLiveSessionDuration]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Rest Timer progress circle (max 180s)
  const maxRest = 180;
  const circumference = 175.929;
  const strokeOffset = circumference - (Math.min(maxRest, restTimerSeconds) / maxRest) * circumference;

  // Real-time Epley 1RM calculation for the quick calculator
  const epleyCalcResult = useMemo(() => {
    return calculateEpley1RM(calcWeight, calcReps);
  }, [calcWeight, calcReps]);

  // Handle set commitment
  const handleCommitCurrentSet = async () => {
    if (!activeLiveWorkout || isSubmittingSet || !currentExercise) return;
    setIsSubmittingSet(true);
    try {
      await commitLiveSet(
        selectedExerciseIndex,
        currentWeight,
        currentReps,
        selectedRir,
        selectedSetType
      );
    } finally {
      setIsSubmittingSet(false);
    }
  };

  // Handle session finalization
  const handleConfirmFinish = async () => {
    setIsSubmittingSet(true);
    try {
      const result = await finishLiveWorkout(postWorkoutNotes, postWorkoutRpe, sessionSeconds);
      if (result.success) {
        setIsFinishModalOpen(false);
        navigate('progreso-del-entrenamiento');
      }
    } finally {
      setIsSubmittingSet(false);
    }
  };

  // If NO live workout session is in progress, show launcher & recent telemetry
  if (!activeLiveWorkout) {
    return (
      <div className="flex flex-col w-full animate-in fade-in duration-150 pb-20 p-4 sm:p-gutter-desktop max-w-[1400px] mx-auto gap-space-lg">
        {/* Recovery Alert Banner if a saved session was detected */}
        {hasRecoveredLiveSession && (
          <div className="w-full bg-primary/10 border border-primary/30 rounded-2xl p-space-md flex flex-col sm:flex-row sm:items-center justify-between gap-space-md">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-primary text-on-primary flex items-center justify-center material-symbols-outlined text-xl shrink-0">
                restore
              </span>
              <div className="flex flex-col">
                <span className="font-headline-sm text-headline-sm font-bold text-on-surface">
                  Sesión en vivo previa detectada
                </span>
                <span className="font-body-md text-body-md text-secondary text-sm">
                  Tienes un entrenamiento guardado en memoria local. Puedes reanudarlo exactamente donde lo dejaste.
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={discardRecoveredLiveSession}
                className="px-4 py-2 rounded-xl bg-surface-container-low text-secondary hover:text-on-surface font-label-md text-sm transition-colors cursor-pointer"
              >
                Descartar
              </button>
              <button
                type="button"
                onClick={resumeRecoveredLiveSession}
                className="px-4 py-2 rounded-xl bg-primary text-on-primary hover:bg-primary-container font-label-md text-sm font-bold shadow-xs transition-all cursor-pointer flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-base">play_arrow</span>
                <span>Reanudar Sesión</span>
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-xs flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-space-sm py-1 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm tracking-wider uppercase font-semibold">
              <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
              MODO GIMNASIO • REGISTRO EN TIEMPO REAL
            </span>
            <span className="text-secondary font-label-sm text-label-sm flex items-center gap-1">
              <span className="material-symbols-outlined text-sm text-primary">cloud_done</span>
              {isDemoMode ? 'Persistencia local aislada (Demo)' : 'Persistencia Cloud Firestore'}
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight mt-1 font-semibold">
            Ejecución de Sesión de Entrenamiento
          </h1>
          <p className="font-body-md text-body-md text-secondary max-w-3xl">
            Registra cada serie efectiva, sobrecarga progresiva, RIR auditado y control de descanso segundo a segundo.
          </p>
        </div>

        {/* Quick Launch Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md mt-2">
          {activeRoutine && activeRoutine.days.length > 0 && (
            <div className="bg-surface-container-lowest p-space-lg rounded-2xl shadow-xs border border-surface-container flex flex-col justify-between gap-space-md hover:border-primary/50 transition-all">
              <div className="flex flex-col gap-space-xs">
                <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary font-bold text-xs uppercase w-max">
                  {activeRoutine.name}
                </span>
                <h3 className="font-headline-md text-headline-md font-bold text-on-surface mt-1">
                  {activeRoutine.days[0].shortName || activeRoutine.days[0].name}
                </h3>
                <p className="font-body-md text-sm text-secondary">
                  {activeRoutine.days[0].focusDescription || 'Sesión periodizada de fuerza e hipertrofia'}
                </p>
                <div className="flex items-center gap-2 text-xs text-secondary mt-2 font-code-data">
                  <span>{activeRoutine.days[0].exercises.length} Ejercicios</span>
                  <span>•</span>
                  <span>{activeRoutine.days[0].exercises.reduce((acc, e) => acc + e.sets, 0)} Series Efectivas</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => startLiveWorkout(activeRoutine, activeRoutine.days[0])}
                className="w-full py-3 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-sm font-bold shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-lg">play_circle</span>
                <span>Iniciar Sesión Día 1</span>
              </button>
            </div>
          )}

          <div className="bg-surface-container-lowest p-space-lg rounded-2xl shadow-xs border border-surface-container flex flex-col justify-between gap-space-md hover:border-primary/50 transition-all">
            <div className="flex flex-col gap-space-xs">
              <span className="px-2.5 py-1 rounded-full bg-secondary-container text-on-secondary-container font-bold text-xs uppercase w-max">
                Entrenamiento Libre
              </span>
              <h3 className="font-headline-md text-headline-md font-bold text-on-surface mt-1">
                Sesión Rápida de Gimnasio
              </h3>
              <p className="font-body-md text-sm text-secondary">
                Lanza una sesión sin plantilla previa con los levantamientos básicos (Press Banca, Remo, Press Militar).
              </p>
              <div className="flex items-center gap-2 text-xs text-secondary mt-2 font-code-data">
                <span>3 Ejercicios Base</span>
                <span>•</span>
                <span>Configuración táctil libre</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => startQuickLiveWorkout('Entrenamiento Rápido')}
              className="w-full py-3 px-4 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface font-label-md text-sm font-bold shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <span className="material-symbols-outlined text-lg">bolt</span>
              <span>Iniciar Sesión Libre</span>
            </button>
          </div>

          <div className="bg-surface-container-lowest p-space-lg rounded-2xl shadow-xs border border-surface-container flex flex-col justify-between gap-space-md hover:border-primary/50 transition-all">
            <div className="flex flex-col gap-space-xs">
              <span className="px-2.5 py-1 rounded-full bg-surface-container text-on-surface-variant font-bold text-xs uppercase w-max">
                Planificador
              </span>
              <h3 className="font-headline-md text-headline-md font-bold text-on-surface mt-1">
                Estructurar Nueva Rutina
              </h3>
              <p className="font-body-md text-sm text-secondary">
                Personaliza series, repeticiones, descansos y tempos en el programador de mesociclos antes de entrenar.
              </p>
              <div className="flex items-center gap-2 text-xs text-secondary mt-2 font-code-data">
                <span>Catálogo de 22+ ejercicios</span>
                <span>•</span>
                <span>Plantillas maestras</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('rutina-de-entrenamiento')}
              className="w-full py-3 px-4 rounded-xl bg-surface-container-low hover:bg-surface-container text-primary font-label-md text-sm font-bold shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer border border-surface-container"
            >
              <span className="material-symbols-outlined text-lg">tune</span>
              <span>Ir a Rutinas</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ACTIVE LIVE WORKOUT VIEW
  const allCompletedSets = activeLiveWorkout.exercisesSnapshot.flatMap(ex => ex.sets.filter(s => s.completed));
  const totalPlannedSets = activeLiveWorkout.exercisesSnapshot.reduce((acc, ex) => acc + ex.sets.length, 0);
  const totalCompletedSets = allCompletedSets.length;
  const sessionTonnage = activeLiveWorkout.totalTonnageKg;
  const estimatedCaloriesBurned = Math.round(sessionTonnage * 0.02 + (sessionSeconds / 60) * 5);

  return (
    <div className="flex flex-col w-full animate-in fade-in duration-150 pb-20">
      {/* Top Gym Session Header */}
      <section className="w-full bg-surface-container-lowest px-4 sm:px-gutter-desktop py-space-lg shadow-xs border-b border-surface-container/40">
        <div className="max-w-[1400px] mx-auto flex flex-col xl:flex-row xl:items-center xl:justify-between gap-space-lg">
          <div className="flex flex-col gap-space-xs">
            <div className="flex flex-wrap items-center gap-space-sm">
              <span className="inline-flex items-center gap-1.5 px-space-sm py-1 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm tracking-wider uppercase font-semibold">
                <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
                Modo Gimnasio Activo • {activeLiveWorkout.routineDayName}
              </span>
              <span className="text-secondary font-label-sm text-label-sm flex items-center gap-1">
                <span className="material-symbols-outlined text-sm text-primary">cloud_done</span>
                {isDemoMode ? 'Persistencia local aislada' : 'Persistencia en tiempo real: Cloud Firestore'}
              </span>
            </div>
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight mt-1 font-semibold">
              {activeLiveWorkout.routineName}: {activeLiveWorkout.routineDayName}
            </h1>
            <p className="font-body-md text-body-md text-secondary max-w-2xl">
              Registro en tiempo real serie a serie, cálculo automático de volumen de tonelaje, RIR auditado y cronómetro de descanso integrado.
            </p>
            <div className="flex items-center gap-space-md text-on-surface-variant font-label-md text-label-md pt-1 flex-wrap">
              <span className="flex items-center gap-1 text-primary font-medium">
                <span className="material-symbols-outlined text-base">play_circle</span>
                Iniciado: {new Date(activeLiveWorkout.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="text-outline-variant">•</span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-base">timer</span>
                Tiempo transcurrido:{' '}
                <span className="font-semibold text-on-surface font-mono">{formatTime(sessionSeconds)} min</span>
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-space-sm">
            <button
              onClick={() => {
                setIsSessionPaused(prev => !prev);
                showToast(isSessionPaused ? 'Sesión reanudada' : 'Sesión pausada');
              }}
              className="px-space-md py-2 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md transition-colors flex items-center gap-space-xs shadow-xs cursor-pointer border border-surface-container/40"
              type="button"
            >
              <span className="material-symbols-outlined text-base">
                {isSessionPaused ? 'play_arrow' : 'pause'}
              </span>
              <span>{isSessionPaused ? 'Reanudar' : 'Pausar Sesión'}</span>
            </button>
            <button
              onClick={() => setIsAbandonModalOpen(true)}
              className="px-space-md py-2 rounded-lg bg-surface-container-low hover:bg-surface-container text-secondary hover:text-on-surface font-label-md text-label-md transition-colors flex items-center gap-space-xs shadow-xs cursor-pointer border border-surface-container/40"
              type="button"
            >
              <span className="material-symbols-outlined text-base">close</span>
              <span>Cancelar</span>
            </button>
            <button
              onClick={() => setIsFinishModalOpen(true)}
              className="px-space-lg py-2.5 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold transition-all flex items-center gap-space-xs shadow-sm cursor-pointer"
              type="button"
            >
              <span className="material-symbols-outlined text-base">check_circle</span>
              <span>Finalizar Entrenamiento</span>
            </button>
          </div>
        </div>
      </section>

      {/* Live Rest Timer and Telemetry Control Strip */}
      <section className="w-full bg-surface-container-low/60 px-4 sm:px-gutter-desktop py-space-md shadow-xs border-b border-surface-container/40">
        <div className="max-w-[1400px] mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-space-md items-center">
          {/* Rest Timer */}
          <div className="lg:col-span-5 bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col sm:flex-row items-center gap-space-md">
            <div className="relative w-16 h-16 shrink-0 flex items-center justify-center cursor-pointer" onClick={toggleRestTimer}>
              <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 64 64">
                <circle
                  className="text-surface-container-highest"
                  cx="32"
                  cy="32"
                  fill="none"
                  r="28"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <circle
                  className="text-primary transition-all duration-300"
                  cx="32"
                  cy="32"
                  fill="none"
                  r="28"
                  stroke="currentColor"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeOffset}
                  strokeLinecap="round"
                  strokeWidth="4"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="material-symbols-outlined text-primary text-xl">
                  {isRestTimerRunning ? 'hourglass_top' : 'pause'}
                </span>
              </div>
            </div>

            <div className="flex-1 flex flex-col gap-1 w-full text-center sm:text-left">
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary font-semibold">
                  Descanso Entre Series
                </span>
                <span className="font-code-data text-code-data text-primary font-semibold flex items-center gap-0.5">
                  <span className="material-symbols-outlined text-sm">vibration</span>
                  Alerta ON
                </span>
              </div>
              <div className="flex items-baseline justify-center sm:justify-start gap-1.5">
                <span className="font-metric-md text-metric-md text-on-surface font-bold tracking-tight font-mono">
                  {formatTime(restTimerSeconds)}
                </span>
                <span className="text-secondary font-label-md text-label-md">/ 03:00 min</span>
              </div>
              <div className="flex items-center justify-center sm:justify-start gap-1 pt-1">
                <button
                  onClick={() => adjustRestTimer(-15)}
                  className="px-2 py-0.5 rounded bg-surface-container-low hover:bg-surface-container text-on-surface-variant font-code-data text-code-data transition-colors cursor-pointer"
                  type="button"
                >
                  -15s
                </button>
                <button
                  onClick={() => adjustRestTimer(30)}
                  className="px-2 py-0.5 rounded bg-surface-container-low hover:bg-surface-container text-on-surface-variant font-code-data text-code-data transition-colors cursor-pointer"
                  type="button"
                >
                  +30s
                </button>
                <button
                  onClick={() => resetRestTimer(currentExercise?.restSeconds || 120)}
                  className="px-2 py-0.5 rounded bg-surface-container-low hover:bg-surface-container text-secondary font-code-data text-code-data transition-colors ml-auto flex items-center gap-0.5 cursor-pointer"
                  type="button"
                >
                  <span className="material-symbols-outlined text-xs">restart_alt</span> Reset
                </button>
              </div>
            </div>
          </div>

          {/* Real-time KPIs Bento */}
          <div className="lg:col-span-7 grid grid-cols-2 sm:grid-cols-4 gap-space-sm">
            <div className="bg-surface-container-lowest p-space-sm rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
              <div className="flex items-center justify-between text-secondary">
                <span className="font-label-sm text-label-sm">Tonelaje Total</span>
                <span className="material-symbols-outlined text-sm text-primary">fitness_center</span>
              </div>
              <div className="mt-1">
                <div className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  {sessionTonnage.toLocaleString()} <span className="text-xs font-normal text-secondary">kg</span>
                </div>
                <div className="w-full bg-surface-container-high h-1.5 rounded-full mt-1.5 overflow-hidden">
                  <div
                    className="bg-primary h-full rounded-full transition-all duration-300"
                    style={{ width: `${Math.min(100, Math.round((sessionTonnage / 12000) * 100))}%` }}
                  />
                </div>
                <span className="font-label-sm text-label-sm text-secondary mt-1 block">Series efectivas</span>
              </div>
            </div>

            <div className="bg-surface-container-lowest p-space-sm rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
              <div className="flex items-center justify-between text-secondary">
                <span className="font-label-sm text-label-sm">Series Hechas</span>
                <span className="material-symbols-outlined text-sm text-primary">task_alt</span>
              </div>
              <div className="mt-1">
                <div className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  {totalCompletedSets} <span className="text-xs font-normal text-secondary">/ {totalPlannedSets}</span>
                </div>
                <div className="w-full bg-surface-container-high h-1.5 rounded-full mt-1.5 overflow-hidden">
                  <div
                    className="bg-primary h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${totalPlannedSets > 0 ? Math.min(100, Math.round((totalCompletedSets / totalPlannedSets) * 100)) : 0}%`,
                    }}
                  />
                </div>
                <span className="font-label-sm text-label-sm text-primary mt-1 block font-medium">
                  {Math.max(0, totalPlannedSets - totalCompletedSets)} series restantes
                </span>
              </div>
            </div>

            <div className="bg-surface-container-lowest p-space-sm rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
              <div className="flex items-center justify-between text-secondary">
                <span className="font-label-sm text-label-sm">RIR Medio</span>
                <span className="material-symbols-outlined text-sm text-primary">speed</span>
              </div>
              <div className="mt-1">
                <div className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  {activeLiveWorkout.averageRir > 0 ? activeLiveWorkout.averageRir : '—'}{' '}
                  <span className="text-xs font-normal text-secondary">RIR</span>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary mt-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" /> Rango óptimo
                </span>
                <span className="font-label-sm text-label-sm text-secondary block">Meta: 1 - 2 RIR</span>
              </div>
            </div>

            <div className="bg-surface-container-lowest p-space-sm rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
              <div className="flex items-center justify-between text-secondary">
                <span className="font-label-sm text-label-sm">Calorías Activas</span>
                <span className="material-symbols-outlined text-sm text-error">local_fire_department</span>
              </div>
              <div className="mt-1">
                <div className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  ~{estimatedCaloriesBurned} <span className="text-xs font-normal text-secondary">kcal</span>
                </div>
                <span className="font-label-sm text-label-sm text-secondary mt-1 flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs text-primary">sync</span> Telemetría de gasto
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Horizontal Exercise Flow Tabs */}
      <section className="w-full bg-surface px-4 sm:px-gutter-desktop pt-space-md pb-space-xs overflow-x-auto">
        <div className="max-w-[1400px] mx-auto flex items-center gap-space-sm min-w-max pb-1">
          {activeLiveWorkout.exercisesSnapshot.map((ex, idx) => {
            const isSelected = selectedExerciseIndex === idx;
            const completedCount = ex.sets.filter(s => s.completed).length;
            const isAllCompleted = ex.sets.length > 0 && completedCount === ex.sets.length;
            const exTonnage = ex.sets.filter(s => s.completed && s.type !== 'warmup').reduce((sum, s) => sum + s.weightKg * s.reps, 0);

            return (
              <button
                key={ex.configId || idx}
                onClick={() => setSelectedExerciseIndex(idx)}
                className={`flex items-center gap-2 px-space-md py-2 rounded-xl transition-all cursor-pointer relative overflow-hidden ${
                  isSelected
                    ? 'bg-surface-container-lowest shadow-sm border border-primary text-left bg-gradient-to-r from-primary/5 to-transparent'
                    : 'bg-surface-container-low/70 hover:bg-surface-container-lowest shadow-xs border border-surface-container/40 text-left'
                }`}
                type="button"
              >
                {isSelected && <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary" />}
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs ${
                    isAllCompleted
                      ? 'bg-primary/20 text-primary'
                      : isSelected
                      ? 'bg-primary text-on-primary'
                      : 'bg-surface-container-highest text-secondary'
                  }`}
                >
                  {isAllCompleted ? (
                    <span className="material-symbols-outlined text-sm">check</span>
                  ) : (
                    idx + 1
                  )}
                </span>
                <div className="flex flex-col">
                  <span className={`font-label-md text-label-md ${isSelected ? 'text-on-surface font-bold' : 'text-on-surface font-medium'}`}>
                    {ex.exerciseName}
                  </span>
                  <span className="font-label-sm text-label-sm text-primary font-semibold flex items-center gap-1">
                    {completedCount} / {ex.sets.length} series • {exTonnage.toLocaleString()} kg
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Main Working Area: Set Logger + Telemetry */}
      {currentExercise && (
        <main className="w-full px-4 sm:px-gutter-desktop py-space-md">
          <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
            {/* Left Column (8 Cols): Active Exercise & Set Table */}
            <div className="lg:col-span-8 flex flex-col gap-space-md">
              <article className="bg-surface-container-lowest rounded-2xl shadow-xs border border-surface-container/50 p-space-lg flex flex-col gap-space-md relative overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pb-space-sm border-b border-surface-container/30">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm font-semibold uppercase">
                        {currentExercise.muscleGroup}
                      </span>
                      <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface font-label-sm text-label-sm capitalize">
                        {currentExercise.equipment}
                      </span>
                      {currentExercise.tempo && (
                        <span className="text-secondary font-label-sm text-label-sm flex items-center gap-1">
                          <span className="material-symbols-outlined text-xs">replay</span>
                          Cadencia: {currentExercise.tempo}
                        </span>
                      )}
                    </div>
                    <h2 className="font-headline-md text-headline-md text-on-surface font-bold tracking-tight mt-1">
                      {currentExercise.exerciseName}
                    </h2>
                    <span className="font-body-md text-body-md text-secondary">
                      Objetivo: {currentExercise.sets.length} series efectivas • RPE 8-9 (RIR 1-2)
                    </span>
                  </div>

                  <div className="bg-surface-container-low p-space-sm rounded-xl flex items-center gap-2 self-start sm:self-auto border border-surface-container/40">
                    <span className="material-symbols-outlined text-primary text-lg">history</span>
                    <div className="flex flex-col">
                      <span className="font-label-sm text-label-sm text-secondary">Récord / Anterior:</span>
                      <span className="font-label-md text-label-md text-on-surface font-semibold tracking-tight">
                        {currentExercise.historicalRecord || '80.0 kg × 8 reps'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Biomechanical Cue */}
                <div className="bg-surface-container-low/70 rounded-xl p-space-sm flex items-center gap-space-sm text-on-surface-variant font-body-md text-body-md border border-surface-container/30">
                  <span className="material-symbols-outlined text-primary text-xl shrink-0">tips_and_updates</span>
                  <p className="leading-snug text-xs sm:text-sm">
                    <span className="font-semibold text-on-surface">Instrucción biomecánica:</span>{' '}
                    {currentExercise.cue || currentExercise.notes || 'Control excéntrico estricto y máxima tensión mecánica en el recorrido.'}
                  </p>
                </div>

                {/* Interactive Set Table */}
                <div className="flex flex-col gap-space-sm mt-2">
                  <div className="grid grid-cols-12 px-space-sm text-secondary font-label-sm text-label-sm uppercase tracking-wider font-semibold">
                    <div className="col-span-3 sm:col-span-2">Serie / Tipo</div>
                    <div className="col-span-3 sm:col-span-3 text-center">Carga (kg)</div>
                    <div className="col-span-2 sm:col-span-2 text-center">Reps</div>
                    <div className="col-span-2 sm:col-span-2 text-center">RIR / Est.</div>
                    <div className="col-span-2 sm:col-span-3 text-right">Confirmar</div>
                  </div>

                  {/* List of sets */}
                  {currentExercise.sets.map((set, setIdx) => {
                    const isSetCompleted = set.completed;
                    const isWorkingSet = !isSetCompleted && set.id === nextIncompleteSet?.id;

                    if (isSetCompleted) {
                      return (
                        <div
                          key={set.id}
                          className="grid grid-cols-12 items-center px-space-sm py-2 rounded-xl bg-surface-container-low/50 text-on-surface font-label-md text-label-md border border-surface-container/30"
                        >
                          <div className="col-span-3 sm:col-span-2 flex items-center gap-1.5">
                            <span className="w-5 h-5 rounded-full bg-primary/20 text-primary flex items-center justify-center font-code-data text-[10px] font-bold">
                              {set.setNumber}
                            </span>
                            <span className="text-xs text-primary font-semibold capitalize">
                              {set.type === 'warmup' ? 'Aprox' : `Efectiva ${set.setNumber}`}
                            </span>
                          </div>
                          <div className="col-span-3 sm:col-span-3 text-center font-semibold">
                            {set.weightKg.toFixed(1)} kg
                          </div>
                          <div className="col-span-2 sm:col-span-2 text-center font-bold">{set.reps}</div>
                          <div className="col-span-2 sm:col-span-2 text-center">
                            <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold text-xs">
                              RIR {set.rir}
                            </span>
                          </div>
                          <div className="col-span-2 sm:col-span-3 text-right">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-primary/15 text-primary text-xs font-bold">
                              <span className="material-symbols-outlined text-xs">check_circle</span>{' '}
                              {set.estimated1RM} kg 1RM
                            </span>
                          </div>
                        </div>
                      );
                    }

                    if (isWorkingSet) {
                      return (
                        <div
                          key={set.id}
                          className="rounded-2xl p-space-md shadow-xs bg-gradient-to-br from-surface-container-lowest to-surface-container-low flex flex-col gap-space-md border border-primary/40 mt-1"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="w-6 h-6 rounded-full bg-primary text-on-primary flex items-center justify-center font-code-data text-xs font-bold shadow-xs">
                                {set.setNumber}
                              </span>
                              <span className="font-headline-sm text-headline-sm text-on-surface font-bold">
                                Serie {set.setNumber} (Actual en curso)
                              </span>
                            </div>
                            <span className="inline-flex items-center gap-1 font-label-sm text-label-sm text-primary font-bold">
                              <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
                              LISTO PARA EJECUTAR
                            </span>
                          </div>

                          {/* Set Type Switcher (Effective vs Warm-up vs Drop set) */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
                              Tipo de serie:
                            </span>
                            {(['effective', 'warmup', 'dropset', 'failure'] as WorkoutSetType[]).map(t => (
                              <button
                                key={t}
                                type="button"
                                onClick={() => setSelectedSetType(t)}
                                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                  selectedSetType === t
                                    ? 'bg-primary text-on-primary shadow-xs'
                                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                                }`}
                              >
                                {t === 'effective'
                                  ? 'Efectiva'
                                  : t === 'warmup'
                                  ? 'Aproximación'
                                  : t === 'dropset'
                                  ? 'Drop Set'
                                  : 'Al Fallo'}
                              </button>
                            ))}
                          </div>

                          {/* Tactile Weight & Rep Steppers */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
                            {/* Weight Stepper */}
                            <div className="bg-surface-container-lowest p-space-sm rounded-xl shadow-xs border border-surface-container flex flex-col gap-1">
                              <label className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
                                Carga de Trabajo
                              </label>
                              <div className="flex items-center justify-between gap-2 mt-1">
                                <button
                                  type="button"
                                  onClick={() => setCurrentWeight(prev => Math.max(0, Math.round((prev - 1) * 10) / 10))}
                                  className="w-10 h-10 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface flex items-center justify-center font-bold text-lg active:scale-95 transition-all cursor-pointer"
                                >
                                  -
                                </button>
                                <div className="flex items-baseline gap-1">
                                  <input
                                    type="number"
                                    step="0.5"
                                    value={currentWeight}
                                    onChange={e => setCurrentWeight(Number(e.target.value) || 0)}
                                    className="font-metric-xl text-metric-xl text-on-surface font-black tabular-nums w-24 text-center bg-transparent focus:outline-none"
                                  />
                                  <span className="font-label-md text-label-md text-secondary font-semibold">kg</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setCurrentWeight(prev => Math.round((prev + 1) * 10) / 10)}
                                  className="w-10 h-10 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface flex items-center justify-center font-bold text-lg active:scale-95 transition-all cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                              <div className="flex justify-center gap-1.5 mt-1">
                                <button
                                  type="button"
                                  onClick={() => setCurrentWeight(prev => Math.max(0, Math.round((prev - 2.5) * 10) / 10))}
                                  className="px-2 py-0.5 rounded bg-surface-container-low text-xs text-secondary hover:text-on-surface font-medium cursor-pointer"
                                >
                                  -2.5 kg
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCurrentWeight(prev => Math.round((prev + 2.5) * 10) / 10)}
                                  className="px-2 py-0.5 rounded bg-surface-container-low text-xs text-secondary hover:text-on-surface font-medium cursor-pointer"
                                >
                                  +2.5 kg
                                </button>
                              </div>
                            </div>

                            {/* Reps Stepper */}
                            <div className="bg-surface-container-lowest p-space-sm rounded-xl shadow-xs border border-surface-container flex flex-col gap-1">
                              <label className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
                                Repeticiones Logradas
                              </label>
                              <div className="flex items-center justify-between gap-2 mt-1">
                                <button
                                  type="button"
                                  onClick={() => setCurrentReps(prev => Math.max(1, prev - 1))}
                                  className="w-10 h-10 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface flex items-center justify-center font-bold text-lg active:scale-95 transition-all cursor-pointer"
                                >
                                  -
                                </button>
                                <div className="flex items-baseline gap-1">
                                  <input
                                    type="number"
                                    value={currentReps}
                                    onChange={e => setCurrentReps(Number(e.target.value) || 1)}
                                    className="font-metric-xl text-metric-xl text-on-surface font-black tabular-nums w-16 text-center bg-transparent focus:outline-none"
                                  />
                                  <span className="font-label-md text-label-md text-secondary font-semibold">reps</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setCurrentReps(prev => prev + 1)}
                                  className="w-10 h-10 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface flex items-center justify-center font-bold text-lg active:scale-95 transition-all cursor-pointer"
                                >
                                  +
                                </button>
                              </div>
                              <div className="flex justify-center gap-1.5 mt-1">
                                <button
                                  type="button"
                                  onClick={() => setCurrentReps(prev => Math.max(1, prev - 1))}
                                  className="px-2 py-0.5 rounded bg-surface-container-low text-xs text-secondary hover:text-on-surface font-medium cursor-pointer"
                                >
                                  -1 rep
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCurrentReps(prev => prev + 1)}
                                  className="px-2 py-0.5 rounded bg-surface-container-low text-xs text-secondary hover:text-on-surface font-medium cursor-pointer"
                                >
                                  +1 rep
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* RIR Selection */}
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                              <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">
                                Esfuerzo Percibido (RIR)
                              </span>
                              <span className="font-label-sm text-label-sm text-primary font-medium">
                                {selectedRir === 0
                                  ? 'RIR 0: Fallo concéntrico total'
                                  : selectedRir === 1
                                  ? 'RIR 1: Esfuerzo alto, 1 rep antes del fallo'
                                  : selectedRir === 2
                                  ? 'RIR 2: 2 reps en recámara'
                                  : 'RIR 3+: Serie ligera o aproximación'}
                              </span>
                            </div>
                            <div className="grid grid-cols-4 gap-2">
                              {[0, 1, 2, 3].map(r => (
                                <button
                                  key={r}
                                  type="button"
                                  onClick={() => setSelectedRir(r)}
                                  className={`py-2 rounded-xl font-label-md text-label-md transition-all text-center cursor-pointer ${
                                    selectedRir === r
                                      ? 'bg-primary text-on-primary font-bold shadow-xs'
                                      : 'bg-surface-container-lowest hover:bg-surface-container-low text-on-surface font-semibold border border-surface-container/40'
                                  }`}
                                >
                                  RIR {r === 3 ? '3+' : r}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Register Button with double-click guard */}
                          <button
                            onClick={handleCommitCurrentSet}
                            disabled={isSubmittingSet}
                            className="w-full py-3.5 px-space-lg rounded-xl bg-primary hover:bg-primary-container text-on-primary font-headline-sm text-headline-sm font-semibold tracking-tight shadow-sm active:scale-[0.99] transition-all flex items-center justify-center gap-space-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-2xl">
                              {isSubmittingSet ? 'sync' : 'check'}
                            </span>
                            <span>
                              {isSubmittingSet
                                ? 'Guardando serie...'
                                : `Registrar Serie ${set.setNumber} & Iniciar Descanso (${currentExercise.restSeconds}s)`}
                            </span>
                          </button>
                        </div>
                      );
                    }

                    // Upcoming queued set
                    return (
                      <div
                        key={set.id}
                        className="grid grid-cols-12 items-center px-space-sm py-2 rounded-xl bg-surface-container-low/20 text-secondary font-label-md text-label-md border border-surface-container/20 opacity-70"
                      >
                        <div className="col-span-3 sm:col-span-2 flex items-center gap-1.5">
                          <span className="w-5 h-5 rounded-full bg-surface-container text-secondary flex items-center justify-center font-code-data text-[10px]">
                            {set.setNumber}
                          </span>
                          <span className="text-xs">Serie {set.setNumber}</span>
                        </div>
                        <div className="col-span-3 sm:col-span-3 text-center">
                          {set.weightKg > 0 ? `${set.weightKg} kg` : '—'}
                        </div>
                        <div className="col-span-2 sm:col-span-2 text-center">
                          {set.targetRepsMin || 8} reps
                        </div>
                        <div className="col-span-2 sm:col-span-2 text-center text-xs">
                          RIR {set.targetRir ?? 2}
                        </div>
                        <div className="col-span-2 sm:col-span-3 text-right text-xs">
                          <span>En cola</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Add Extra Set */}
                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => addExtraLiveSet(selectedExerciseIndex, 'dropset')}
                    className="px-space-md py-2 rounded-lg bg-surface-container-low hover:bg-surface-container text-primary font-label-md text-label-md font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-surface-container/40"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-base">add</span>
                    <span>Añadir Serie Extra (Drop set o Back-off)</span>
                  </button>
                  <span className="font-code-data text-code-data text-secondary">
                    Volumen acumulado ejercicio:{' '}
                    {currentExercise.sets
                      .filter(s => s.completed && s.type !== 'warmup')
                      .reduce((sum, s) => sum + s.weightKg * s.reps, 0)
                      .toLocaleString()}{' '}
                    kg
                  </span>
                </div>
              </article>

              {/* Other Exercises in Session Breakdown */}
              <div className="flex flex-col gap-space-sm mt-2">
                <span className="font-label-sm text-label-sm uppercase tracking-wider text-secondary font-semibold">
                  Resumen de Todos los Ejercicios de la Sesión
                </span>
                {activeLiveWorkout.exercisesSnapshot.map((ex, exIdx) => {
                  const completed = ex.sets.filter(s => s.completed);
                  const isExpanded = expandedExerciseIndex === exIdx;
                  const exTonnage = completed.filter(s => s.type !== 'warmup').reduce((s, set) => s + set.weightKg * set.reps, 0);

                  return (
                    <article
                      key={ex.configId || exIdx}
                      className="bg-surface-container-lowest rounded-2xl p-space-md shadow-xs border border-surface-container/50 flex flex-col gap-space-sm"
                    >
                      <div
                        className="flex items-center justify-between cursor-pointer"
                        onClick={() => setExpandedExerciseIndex(isExpanded ? null : exIdx)}
                      >
                        <div className="flex items-center gap-space-sm">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold ${
                              completed.length === ex.sets.length && ex.sets.length > 0
                                ? 'bg-primary/10 text-primary'
                                : 'bg-surface-container text-secondary'
                            }`}
                          >
                            <span className="material-symbols-outlined text-lg">
                              {completed.length === ex.sets.length && ex.sets.length > 0 ? 'check' : 'fitness_center'}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                                {ex.exerciseName}
                              </h3>
                              <span
                                className={`px-2 py-0.2 rounded-full font-label-sm text-label-sm font-semibold ${
                                  completed.length === ex.sets.length && ex.sets.length > 0
                                    ? 'bg-primary/10 text-primary'
                                    : 'bg-surface-container text-secondary'
                                }`}
                              >
                                {completed.length === ex.sets.length && ex.sets.length > 0 ? 'Completado' : 'En progreso'}
                              </span>
                              <span className="px-2 py-0.2 rounded-full bg-surface-container-high text-on-surface font-label-sm text-label-sm">
                                {completed.length} / {ex.sets.length} series
                              </span>
                            </div>
                            <span className="font-label-sm text-label-sm text-secondary">
                              Tonelaje: {exTonnage.toLocaleString()} kg • Descanso: {ex.restSeconds}s
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-space-xs text-secondary">
                          <span className="font-label-sm text-label-sm font-medium">
                            {isExpanded ? 'Ocultar' : 'Ver desglose'}
                          </span>
                          <span className={`material-symbols-outlined text-lg transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                            expand_more
                          </span>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="pt-space-xs grid grid-cols-2 sm:grid-cols-4 gap-space-xs">
                          {ex.sets.map(s => (
                            <div
                              key={s.id}
                              className={`p-space-sm rounded-lg flex flex-col border ${
                                s.completed
                                  ? 'bg-surface-container-low border-surface-container/30'
                                  : 'bg-surface-container-lowest border-surface-container/20 opacity-60'
                              }`}
                            >
                              <span className="text-[11px] font-semibold text-secondary">Serie {s.setNumber}</span>
                              <span className="font-label-md text-label-md text-on-surface font-bold">
                                {s.completed ? `${s.weightKg} kg × ${s.reps} reps` : 'Pendiente'}
                              </span>
                              <span className="text-[10px] text-primary font-medium">
                                {s.completed ? `RIR ${s.rir} • ${s.estimated1RM} kg 1RM` : `Objetivo: RIR ${s.targetRir ?? 2}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>

            {/* Right Column (4 Cols): 1RM Calculator & Biomechanical Audit */}
            <aside className="lg:col-span-4 flex flex-col gap-space-md">
              {/* Quick 1RM Calculator with Epley Formula & Scientific Reliability Warning */}
              <div className="bg-surface-container-lowest rounded-2xl p-space-md shadow-xs border border-surface-container/50 flex flex-col gap-space-sm">
                <div className="flex items-center justify-between pb-1 border-b border-surface-container/30">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-primary text-xl">calculate</span>
                    <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                      Calculadora 1RM Rápida
                    </h3>
                  </div>
                  <span className="font-label-sm text-label-sm text-secondary font-code-data">Fórmula Epley</span>
                </div>
                <p className="font-label-sm text-label-sm text-secondary">
                  Calcula la intensidad y porcentajes submáximos en base al peso y repeticiones de la serie actual.
                </p>
                <div className="grid grid-cols-2 gap-space-sm pt-1">
                  <div className="bg-surface-container-low p-space-sm rounded-xl flex flex-col border border-surface-container/40">
                    <span className="font-label-sm text-label-sm text-secondary font-medium">Carga Base</span>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <input
                        type="number"
                        value={calcWeight}
                        onChange={e => setCalcWeight(Number(e.target.value) || 0)}
                        className="w-16 font-metric-md text-metric-md font-bold text-on-surface bg-transparent focus:outline-none"
                      />
                      <span className="text-xs font-semibold text-secondary">kg</span>
                    </div>
                  </div>
                  <div className="bg-surface-container-low p-space-sm rounded-xl flex flex-col border border-surface-container/40">
                    <span className="font-label-sm text-label-sm text-secondary font-medium">Repeticiones</span>
                    <div className="flex items-baseline gap-1 mt-0.5">
                      <input
                        type="number"
                        value={calcReps}
                        onChange={e => setCalcReps(Number(e.target.value) || 1)}
                        className="w-16 font-metric-md text-metric-md font-bold text-on-surface bg-transparent focus:outline-none"
                      />
                      <span className="text-xs font-semibold text-secondary">reps</span>
                    </div>
                  </div>
                </div>

                {/* Scientific Reliability Notice for High Reps */}
                {!epleyCalcResult.isReliable && epleyCalcResult.warning && (
                  <div className="p-2.5 rounded-xl bg-secondary-container/40 text-on-secondary-container text-xs flex items-start gap-2 border border-secondary/30">
                    <span className="material-symbols-outlined text-sm text-secondary shrink-0 mt-0.5">warning</span>
                    <span>{epleyCalcResult.warning}</span>
                  </div>
                )}

                {/* Result Card */}
                <div className="bg-surface-container-low rounded-xl p-space-sm flex items-center justify-between mt-1 border border-surface-container/40">
                  <div className="flex flex-col">
                    <span className="font-label-sm text-label-sm text-secondary font-semibold uppercase">
                      1RM Teórico Estimado
                    </span>
                    <span className="font-metric-xl text-metric-xl text-primary font-black">
                      {epleyCalcResult.value} kg
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-label-sm text-label-sm text-primary font-bold">100% Intensidad</span>
                    <span className="text-xs text-secondary block font-code-data">Epley 1RM</span>
                  </div>
                </div>

                {/* Submaximal Table */}
                <div className="flex flex-col gap-1 pt-1 font-label-sm text-label-sm">
                  <div className="flex items-center justify-between text-secondary uppercase font-semibold px-1 text-[11px]">
                    <span>Intensidad</span>
                    <span>Carga Sugerida</span>
                    <span>Rango Reps</span>
                  </div>
                  {epleyCalcResult.submaximalPercentages.map(sub => (
                    <div
                      key={sub.percentage}
                      className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-surface-container-low/50"
                    >
                      <span className="font-bold text-on-surface">{sub.percentage}%</span>
                      <span className="font-semibold text-primary font-code-data">{sub.weightKg} kg</span>
                      <span className="text-secondary text-xs">{sub.recommendedReps}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Fatigue & Technique Check */}
              <div className="bg-surface-container-lowest rounded-2xl p-space-md shadow-xs border border-surface-container/50 flex flex-col gap-space-sm">
                <div className="flex items-center gap-1.5 pb-1 border-b border-surface-container/30">
                  <span className="material-symbols-outlined text-primary text-xl">monitor_heart</span>
                  <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                    Auditoría de Fatiga &amp; Técnica
                  </h3>
                </div>
                <div className="flex flex-col gap-2 pt-1 font-body-md text-body-md text-xs">
                  <label className="flex items-start gap-space-sm p-space-sm rounded-xl hover:bg-surface-container-low transition-colors cursor-pointer">
                    <input defaultChecked className="mt-0.5 rounded text-primary focus:ring-0 w-4 h-4 accent-primary" type="checkbox" />
                    <div className="flex flex-col">
                      <span className="font-label-md text-label-md text-on-surface font-semibold">Fatiga central controlada</span>
                      <span className="font-label-sm text-label-sm text-secondary">Sin degradación involuntaria de la velocidad de barra.</span>
                    </div>
                  </label>
                  <label className="flex items-start gap-space-sm p-space-sm rounded-xl hover:bg-surface-container-low transition-colors cursor-pointer">
                    <input defaultChecked className="mt-0.5 rounded text-primary focus:ring-0 w-4 h-4 accent-primary" type="checkbox" />
                    <div className="flex flex-col">
                      <span className="font-label-md text-label-md text-on-surface font-semibold">Molestias articulares: Ninguna</span>
                      <span className="font-label-sm text-label-sm text-secondary">Hombros y zona lumbar limpios y estables.</span>
                    </div>
                  </label>
                  <label className="flex items-start gap-space-sm p-space-sm rounded-xl hover:bg-surface-container-low transition-colors cursor-pointer">
                    <input defaultChecked className="mt-0.5 rounded text-primary focus:ring-0 w-4 h-4 accent-primary" type="checkbox" />
                    <div className="flex flex-col">
                      <span className="font-label-md text-label-md text-on-surface font-semibold">Trayectoria biomecánica estricta</span>
                      <span className="font-label-sm text-label-sm text-secondary">Fase concéntrica explosiva con parada técnica controlada.</span>
                    </div>
                  </label>
                </div>
              </div>

              {/* Firestore Telemetry Badge */}
              <div className="p-space-sm rounded-xl bg-surface-container-low/70 flex items-center gap-space-sm text-secondary font-label-sm text-label-sm border border-surface-container/30">
                <span className="material-symbols-outlined text-primary text-base shrink-0">database</span>
                <span>
                  Cada serie confirmada se sincroniza en tiempo real con Cloud Firestore en <code className="font-code-data text-on-surface font-semibold">users/{'{uid}'}/workoutSessions</code>.
                </span>
              </div>
            </aside>
          </div>
        </main>
      )}

      {/* FINISH WORKOUT SUMMARY MODAL */}
      {isFinishModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest max-w-lg w-full rounded-2xl shadow-xl border border-surface-container p-space-lg flex flex-col gap-space-md animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 border-b border-surface-container/50">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-2xl">check_circle</span>
                <h3 className="font-headline-md text-headline-md font-bold text-on-surface">
                  Finalizar Entrenamiento
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsFinishModalOpen(false)}
                className="text-secondary hover:text-on-surface p-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-xl">close</span>
              </button>
            </div>

            <p className="font-body-md text-sm text-secondary">
              ¡Gran trabajo! Confirma el balance de tu sesión para registrar el tonelaje acumulado y actualizar tu progreso.
            </p>

            <div className="grid grid-cols-2 gap-space-sm bg-surface-container-low p-space-md rounded-xl">
              <div className="flex flex-col">
                <span className="text-xs text-secondary uppercase font-semibold">Duración</span>
                <span className="font-headline-sm font-bold text-on-surface font-mono">
                  {formatTime(sessionSeconds)} min
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-secondary uppercase font-semibold">Tonelaje Total</span>
                <span className="font-headline-sm font-bold text-primary font-mono">
                  {sessionTonnage.toLocaleString()} kg
                </span>
              </div>
              <div className="flex flex-col mt-2">
                <span className="text-xs text-secondary uppercase font-semibold">Series Efectivas</span>
                <span className="font-headline-sm font-bold text-on-surface">
                  {totalCompletedSets} series
                </span>
              </div>
              <div className="flex flex-col mt-2">
                <span className="text-xs text-secondary uppercase font-semibold">RIR Medio</span>
                <span className="font-headline-sm font-bold text-on-surface">
                  {activeLiveWorkout.averageRir} RIR
                </span>
              </div>
            </div>

            {/* Subjective Session RPE */}
            <div className="flex flex-col gap-1.5">
              <label className="font-label-md text-label-md font-semibold text-on-surface">
                Esfuerzo Percibido de la Sesión (RPE 1-10): <strong className="text-primary">{postWorkoutRpe}</strong>
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {[7, 7.5, 8, 8.5, 9, 9.5, 10].map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setPostWorkoutRpe(val)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      postWorkoutRpe === val
                        ? 'bg-primary text-on-primary shadow-xs'
                        : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    RPE {val}
                  </button>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div className="flex flex-col gap-1">
              <label className="font-label-md text-label-md font-semibold text-on-surface">
                Notas y sensaciones del entrenamiento:
              </label>
              <textarea
                value={postWorkoutNotes}
                onChange={e => setPostWorkoutNotes(e.target.value)}
                placeholder="Ej: Excelente congestión en press inclinado, subir +2.5 kg en la próxima semana..."
                className="w-full text-sm p-3 rounded-xl bg-surface-container-low text-on-surface border border-surface-container focus:ring-1 focus:ring-primary focus:outline-none resize-none"
                rows={3}
              />
            </div>

            <div className="flex items-center justify-end gap-space-sm pt-2">
              <button
                type="button"
                onClick={() => setIsFinishModalOpen(false)}
                className="px-4 py-2 rounded-xl text-secondary hover:text-on-surface font-label-md text-sm cursor-pointer"
              >
                Continuar Entrenando
              </button>
              <button
                type="button"
                onClick={handleConfirmFinish}
                className="px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-sm font-bold shadow-xs cursor-pointer flex items-center gap-1.5"
              >
                <span className="material-symbols-outlined text-base">check</span>
                <span>Guardar y Finalizar</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ABANDON CONFIRMATION MODAL */}
      {isAbandonModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest max-w-md w-full rounded-2xl shadow-xl border border-surface-container p-space-lg flex flex-col gap-space-md animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2 text-error">
              <span className="material-symbols-outlined text-2xl">warning</span>
              <h3 className="font-headline-md text-headline-md font-bold">¿Cancelar sesión actual?</h3>
            </div>
            <p className="font-body-md text-sm text-secondary">
              Se cancelará la sesión en vivo y las series incompletas no se acumularán en el tonelaje de hoy.
            </p>
            <div className="flex items-center justify-end gap-space-sm pt-2">
              <button
                type="button"
                onClick={() => setIsAbandonModalOpen(false)}
                className="px-4 py-2 rounded-xl text-secondary hover:text-on-surface font-label-md text-sm cursor-pointer"
              >
                Volver al entrenamiento
              </button>
              <button
                type="button"
                onClick={async () => {
                  setIsAbandonModalOpen(false);
                  await abandonLiveWorkout();
                }}
                className="px-4 py-2 rounded-xl bg-error/15 text-error hover:bg-error/25 font-label-md text-sm font-bold cursor-pointer"
              >
                Sí, Cancelar Sesión
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
