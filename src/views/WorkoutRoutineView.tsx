import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { getExerciseById } from '../data/exerciseCatalog';
import { PlannedExerciseConfig, RoutineDay } from '../types/workout';
import { AddExerciseToRoutineModal } from '../components/modals/AddExerciseToRoutineModal';
import { EditRoutineExerciseModal } from '../components/modals/EditRoutineExerciseModal';
import { ManageRoutinesModal } from '../components/modals/ManageRoutinesModal';
import { AutoregulationSuggestionModal } from '../components/modals/AutoregulationSuggestionModal';
import { DeloadAssistantModal } from '../components/modals/DeloadAssistantModal';
import { MASTER_WORKOUT_TEMPLATES } from '../data/workoutTemplates';
import {
  generateDayRecommendations,
  ExerciseRecommendation,
  DeloadProposal,
} from '../services/workoutAutoregulationService';

export const WorkoutRoutineView: React.FC = () => {
  const {
    navigate,
    showToast,
    workoutRoutines,
    activeRoutine,
    activeRoutineId,
    setActiveRoutineId,
    routineSyncStatus,
    createRoutineFromTemplate,
    createCustomRoutine,
    updateWorkoutRoutine,
    deleteWorkoutRoutine,
    addExerciseToRoutineDay,
    removeExerciseFromRoutineDay,
    reorderExercisesInRoutineDay,
    updateRoutineExerciseConfig,
    isDemoMode,
    currentUser,
    startLiveWorkout,
    executedWorkoutsHistory,
    workoutHistory,
  } = useApp();

  // Selected Day in Active Routine
  const [selectedDayId, setSelectedDayId] = useState<string>('d1');
  const [isStartingWorkout, setIsStartingWorkout] = useState(false);

  // Modals State
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [isAddExerciseModalOpen, setIsAddExerciseModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<PlannedExerciseConfig | null>(null);
  const [isDeloadModalOpen, setIsDeloadModalOpen] = useState(false);
  const [selectedRecommendation, setSelectedRecommendation] = useState<ExerciseRecommendation | null>(null);
  const [isSuggestionModalOpen, setIsSuggestionModalOpen] = useState(false);

  // Fallback to first day if current day is not in active routine
  const currentDay = useMemo<RoutineDay | null>(() => {
    if (!activeRoutine || activeRoutine.days.length === 0) return null;
    const found = activeRoutine.days.find(d => d.id === selectedDayId);
    return found || activeRoutine.days[0];
  }, [activeRoutine, selectedDayId]);

  // Dynamic KPIs derived from active routine
  const totalWeeklySets = useMemo(() => {
    if (!activeRoutine) return 0;
    return activeRoutine.days.reduce(
      (acc, day) => acc + day.exercises.reduce((sAcc, ex) => sAcc + ex.sets, 0),
      0
    );
  }, [activeRoutine]);

  const totalExercisesCount = useMemo(() => {
    if (!activeRoutine) return 0;
    return activeRoutine.days.reduce((acc, day) => acc + day.exercises.length, 0);
  }, [activeRoutine]);

  // Dynamic Muscle Breakdown for active routine
  const muscleBreakdown = useMemo(() => {
    const counts = {
      pecho: 0,
      espalda: 0,
      cuadriceps: 0,
      isquiosGluteos: 0,
      hombrosBrazos: 0,
      core: 0,
    };

    if (!activeRoutine) return counts;

    activeRoutine.days.forEach(day => {
      day.exercises.forEach(cfg => {
        const ex = getExerciseById(cfg.exerciseId);
        if (!ex) return;
        if (ex.muscleGroup === 'pecho') counts.pecho += cfg.sets;
        else if (ex.muscleGroup === 'espalda') counts.espalda += cfg.sets;
        else if (ex.muscleGroup === 'cuadriceps') counts.cuadriceps += cfg.sets;
        else if (ex.muscleGroup === 'isquios' || ex.muscleGroup === 'gluteos') counts.isquiosGluteos += cfg.sets;
        else if (ex.muscleGroup === 'hombros' || ex.muscleGroup === 'biceps' || ex.muscleGroup === 'triceps')
          counts.hombrosBrazos += cfg.sets;
        else if (ex.muscleGroup === 'core') counts.core += cfg.sets;
        else counts.espalda += cfg.sets; // full body / otros
      });
    });

    return counts;
  }, [activeRoutine]);

  // Autoregulation recommendations for current day
  const dayRecommendationsMap = useMemo(() => {
    if (!currentDay) return new Map<string, ExerciseRecommendation>();
    const recs = generateDayRecommendations(currentDay, executedWorkoutsHistory, workoutHistory);
    const map = new Map<string, ExerciseRecommendation>();
    recs.forEach(r => map.set(r.configId, r));
    return map;
  }, [currentDay, executedWorkoutsHistory, workoutHistory]);

  // Overall plateau count across the entire active routine
  const plateauCountInActiveRoutine = useMemo(() => {
    if (!activeRoutine) return 0;
    let count = 0;
    activeRoutine.days.forEach(d => {
      const recs = generateDayRecommendations(d, executedWorkoutsHistory, workoutHistory);
      count += recs.filter(r => r.plateauStatus === 'possible_plateau').length;
    });
    return count;
  }, [activeRoutine, executedWorkoutsHistory, workoutHistory]);

  const handleApplyRecommendation = async (updates: {
    targetWeightKg?: number;
    repsMin?: number;
    repsMax?: number;
    targetRir?: number;
  }) => {
    if (!activeRoutine || !currentDay || !selectedRecommendation) return;
    await updateRoutineExerciseConfig(
      activeRoutine.id,
      currentDay.id,
      selectedRecommendation.configId,
      updates
    );
  };

  const handleApplyDeload = async (proposal: DeloadProposal) => {
    if (!activeRoutine) return;
    const newId = await createCustomRoutine({
      name: proposal.deloadRoutineName,
      description: proposal.rationale,
      goal: activeRoutine.goal,
      frequencyDays: activeRoutine.frequencyDays,
      days: proposal.days,
      isDefault: true,
    });
    setActiveRoutineId(newId);
  };

  // Export PDF or Markdown
  const handleExportSummary = () => {
    if (!activeRoutine) return;
    showToast(`Resumen de "${activeRoutine.name}" generado para impresión`);
    window.print();
  };

  const handleStartLiveSession = async () => {
    if (isStartingWorkout || !activeRoutine || !currentDay) return;
    if (currentDay.exercises.length === 0) {
      showToast('Añade al menos un ejercicio a este día para iniciar el entrenamiento', 'warning');
      return;
    }
    setIsStartingWorkout(true);
    try {
      await startLiveWorkout(activeRoutine, currentDay);
    } finally {
      setIsStartingWorkout(false);
    }
  };

  // If user has zero routines (e.g. newly registered cloud account), show initial template picker
  if (!activeRoutine) {
    return (
      <div className="p-4 sm:p-gutter-desktop max-w-[1440px] mx-auto w-full flex flex-col gap-space-lg animate-in fade-in duration-150">
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-xs flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container text-primary font-label-sm text-label-sm font-semibold tracking-wide shadow-xs">
              <span className="material-symbols-outlined text-xs">fitness_center</span>
              PROGRAMADOR DE ENTRENAMIENTO • VIGOR CORE
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight mt-0.5 font-semibold">
            Configuración de Rutina de Entrenamiento
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-4xl">
            Aún no tienes una rutina activa asignada a tu cuenta. Elige una de las plantillas científicamente periodizadas para comenzar tu plan de fuerza e hipertrofia.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md mt-4">
          {MASTER_WORKOUT_TEMPLATES.map(tpl => (
            <div
              key={tpl.id}
              className="bg-surface-container-lowest rounded-2xl p-space-lg shadow-sm border border-surface-container/80 flex flex-col justify-between gap-space-md hover:border-primary/60 transition-all"
            >
              <div className="flex flex-col gap-space-xs">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-1 rounded-full bg-primary/10 text-primary font-bold text-xs uppercase tracking-wider">
                    {tpl.frequencyDays} Días / Sem
                  </span>
                  <span className="capitalize text-xs text-on-surface-variant font-medium">
                    Meta: {tpl.goal}
                  </span>
                </div>
                <h2 className="font-headline-md text-headline-md font-bold text-on-surface mt-1">
                  {tpl.name}
                </h2>
                <p className="font-body-md text-sm text-on-surface-variant">
                  {tpl.description}
                </p>
                <div className="flex items-center gap-3 text-xs text-on-surface-variant mt-2 font-code-data">
                  <span>{tpl.days.length} Días</span>
                  <span>•</span>
                  <span>{tpl.days.reduce((a, d) => a + d.exercises.length, 0)} Ejercicios</span>
                  <span>•</span>
                  <span>{tpl.days.reduce((a, d) => a + d.exercises.reduce((s, e) => s + e.sets, 0), 0)} Series</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => createRoutineFromTemplate(tpl.id)}
                className="w-full py-3 px-4 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-label-md text-sm font-bold shadow-xs cursor-pointer flex items-center justify-center gap-2 transition-all"
              >
                <span className="material-symbols-outlined text-base">add_circle</span>
                <span>Comenzar con {tpl.name.split('(')[0]}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-gutter-desktop max-w-[1440px] mx-auto w-full flex flex-col gap-space-lg animate-in fade-in duration-150">
      {/* Top Program Badge & Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md">
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-xs flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container text-primary font-label-sm text-label-sm font-semibold tracking-wide shadow-xs">
              <span className="material-symbols-outlined text-xs">fitness_center</span>
              PROGRAMA: {activeRoutine.name.toUpperCase()} • {activeRoutine.goal.toUpperCase()}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              {activeRoutine.frequencyDays} Sesiones / Semana
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight mt-0.5 font-semibold">
            Rutina de Entrenamiento Semanal
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-4xl">
            {activeRoutine.description}
          </p>
        </div>

        <div className="flex items-center gap-space-xs shrink-0 flex-wrap">
          <button
            onClick={() => setIsDeloadModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container-lowest hover:bg-surface-container text-on-surface font-label-md text-label-md shadow-xs transition-colors cursor-pointer border border-surface-container font-medium"
            type="button"
          >
            <span className="material-symbols-outlined text-base text-primary">bedtime</span>
            <span>Asistente de Descarga</span>
          </button>
          <button
            onClick={handleExportSummary}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container-lowest hover:bg-surface-container text-on-surface font-label-md text-label-md shadow-xs transition-colors cursor-pointer border border-surface-container"
            type="button"
          >
            <span className="material-symbols-outlined text-base text-secondary">picture_as_pdf</span>
            <span>Exportar PDF</span>
          </button>
          <button
            onClick={() => setIsManageModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-surface-container-lowest hover:bg-surface-container text-on-surface font-label-md text-label-md shadow-xs transition-colors cursor-pointer border border-surface-container"
            type="button"
          >
            <span className="material-symbols-outlined text-base text-secondary">tune</span>
            <span>Cambiar / Personalizar Mesociclo</span>
          </button>
          {currentDay && (
            <button
              onClick={() => setIsAddExerciseModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md shadow-sm transition-all cursor-pointer font-medium"
              type="button"
            >
              <span className="material-symbols-outlined text-base">add</span>
              <span>+ Añadir Ejercicio</span>
            </button>
          )}
        </div>
      </div>

      {/* Optional Plateau Awareness Banner */}
      {plateauCountInActiveRoutine > 0 && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs animate-in fade-in duration-150">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-amber-800 text-lg shrink-0">warning</span>
            <span>
              <strong>{plateauCountInActiveRoutine} ejercicio(s)</strong> con posible estancamiento tras 3 o más sesiones consecutivas sin mejoras. Consulta las sugerencias por ejercicio o valora una semana de descarga.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setIsDeloadModalOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-amber-200/90 hover:bg-amber-300 font-bold text-amber-950 transition-colors shrink-0 cursor-pointer"
          >
            Explorar Descarga (Deload)
          </button>
        </div>
      )}

      {/* KPI Bento Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-space-sm">
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-xs">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
              Frecuencia
            </span>
            <span className="material-symbols-outlined text-base text-primary">calendar_month</span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-metric-xl text-metric-xl font-bold text-on-surface tabular-nums">
              {activeRoutine.frequencyDays}
            </span>
            <span className="font-label-md text-label-md text-on-surface-variant">Días / Sem</span>
          </div>
          <div className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1 truncate">
            <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            <span className="truncate">{activeRoutine.name}</span>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-xs">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
              Volumen Semanal
            </span>
            <span className="material-symbols-outlined text-base text-tertiary">layers</span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-metric-xl text-metric-xl font-bold text-on-surface tabular-nums">
              {totalWeeklySets}
            </span>
            <span className="font-label-md text-label-md text-on-surface-variant">Series Efectivas</span>
          </div>
          <div className="font-label-sm text-label-sm text-primary font-medium flex items-center gap-1">
            <span className="material-symbols-outlined text-xs">fitness_center</span>
            <span>{totalExercisesCount} ejercicios catalogados</span>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-xs">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
              Intensidad Media
            </span>
            <span className="material-symbols-outlined text-base text-primary">speed</span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-metric-xl text-metric-xl font-bold text-on-surface tabular-nums">
              RIR 1-2
            </span>
          </div>
          <div className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1">
            <span className="material-symbols-outlined text-xs text-primary">verified</span>
            <span>Proximidad al fallo controlada</span>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-xs">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
              Sobrecarga
            </span>
            <span className="material-symbols-outlined text-base text-primary">line_weight</span>
          </div>
          <div className="flex items-baseline gap-1 mt-1">
            <span className="font-metric-md text-metric-md font-bold text-on-surface tabular-nums">+1.25 a 2.5</span>
            <span className="font-label-md text-label-md text-on-surface-variant">kg</span>
          </div>
          <div className="font-label-sm text-label-sm text-on-surface-variant flex items-center gap-1">
            <span>Micro-cargas al completar rango</span>
          </div>
        </div>

        {/* Real Sync Indicator */}
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-xs">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
              Sincronización
            </span>
            <span className="material-symbols-outlined text-base text-primary">
              {routineSyncStatus === 'saving' ? 'sync' : 'cloud_done'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span
              className={`w-2 h-2 rounded-full ${
                routineSyncStatus === 'saving'
                  ? 'bg-secondary animate-ping'
                  : routineSyncStatus === 'error'
                  ? 'bg-error'
                  : 'bg-primary'
              }`}
            />
            <span className="font-headline-sm text-headline-sm font-semibold text-on-surface truncate">
              {isDemoMode ? 'Modo Demo' : 'Firestore Cloud'}
            </span>
          </div>
          <div className="font-label-sm text-label-sm text-on-surface-variant truncate">
            {routineSyncStatus === 'saving'
              ? 'Guardando cambios...'
              : routineSyncStatus === 'error'
              ? 'Error al sincronizar'
              : isDemoMode
              ? 'Persistencia local aislada'
              : 'Sincronizado en tiempo real'}
          </div>
        </div>
      </div>

      {/* Week Navigator Tabs */}
      <div className="flex flex-col gap-space-xs">
        <div className="flex items-center justify-between">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold">
            Microciclo Semanal (Días de Entrenamiento)
          </span>
          <span className="font-code-data text-code-data text-primary bg-surface-container px-2 py-0.5 rounded">
            Meta: {activeRoutine.goal.toUpperCase()}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-space-xs bg-surface-container-low p-1.5 rounded-2xl shadow-xs border border-surface-container/60">
          {activeRoutine.days.map((day, idx) => {
            const isSelected = (currentDay?.id || activeRoutine.days[0].id) === day.id;
            const dayExercisesCount = day.exercises.length;
            const daySetsCount = day.exercises.reduce((acc, ex) => acc + ex.sets, 0);

            return (
              <button
                key={day.id}
                onClick={() => setSelectedDayId(day.id)}
                type="button"
                className={`flex flex-col p-space-sm rounded-xl text-left transition-all relative overflow-hidden cursor-pointer ${
                  isSelected
                    ? 'bg-surface-container-lowest shadow-sm text-on-surface'
                    : 'hover:bg-surface-container-lowest/80 text-on-surface-variant'
                } ${day.isRestDay ? 'opacity-90' : ''}`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span
                    className={`font-label-sm text-label-sm uppercase tracking-wider text-[11px] ${
                      isSelected ? 'text-primary font-bold' : 'text-on-surface-variant font-medium'
                    }`}
                  >
                    Día {idx + 1} • {day.dayOfWeek || `D${idx + 1}`}
                  </span>
                  {day.isRestDay ? (
                    <span className="material-symbols-outlined text-xs text-secondary">bed</span>
                  ) : (
                    isSelected && <span className="w-2 h-2 rounded-full bg-primary" />
                  )}
                </div>

                <span className="font-headline-sm text-headline-sm font-semibold truncate text-on-surface">
                  {day.shortName || day.name}
                </span>

                <div className="flex items-center gap-2 mt-2 font-code-data text-code-data text-on-surface-variant text-[11px]">
                  {day.isRestDay && dayExercisesCount === 0 ? (
                    <span>Descanso Activo</span>
                  ) : (
                    <>
                      <span>{dayExercisesCount} Ejercicios</span>
                      <span>•</span>
                      <span>{daySetsCount} Series</span>
                    </>
                  )}
                </div>

                {isSelected && <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Split Grid: Exercises (8 Cols) + Telemetry & Guidelines (4 Cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
        {/* Left Column (8 Cols): Exercises for Selected Day */}
        <div className="lg:col-span-8 flex flex-col gap-space-md">
          {currentDay && (
            <>
              {/* Day Overview Banner */}
              <div className="bg-surface-container-lowest rounded-2xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col md:flex-row md:items-center justify-between gap-space-md">
                <div className="flex flex-col gap-space-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2.5 py-1 rounded-md bg-primary-fixed/50 text-on-primary-fixed-variant font-label-sm text-label-sm font-bold uppercase tracking-wider">
                      {currentDay.name}
                    </span>
                    <span className="px-2.5 py-1 rounded-md bg-surface-container text-on-surface-variant font-label-sm text-label-sm font-medium">
                      {currentDay.focusDescription || 'Fuerza & Grosor'}
                    </span>
                    <span className="px-2.5 py-1 rounded-md bg-secondary-container/60 text-on-secondary-container font-label-sm text-label-sm font-medium">
                      Calentamiento: 8-10 min
                    </span>
                  </div>
                  <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
                    {currentDay.shortName || currentDay.name}
                  </h2>
                  <div className="flex items-center gap-space-md text-on-surface-variant font-label-md text-label-md">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm text-primary">fitness_center</span>{' '}
                      Ejercicios:{' '}
                      <strong className="text-on-surface font-semibold tabular-nums">
                        {currentDay.exercises.length}
                      </strong>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm text-primary">layers</span> Series
                      Efectivas:{' '}
                      <strong className="text-on-surface font-semibold tabular-nums">
                        {currentDay.exercises.reduce((acc, ex) => acc + ex.sets, 0)}
                      </strong>
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm text-primary">hourglass_empty</span>{' '}
                      Descanso:{' '}
                      <strong className="text-on-surface font-semibold">
                        ~{Math.round(currentDay.exercises.reduce((acc, ex) => acc + (ex.sets * ex.restSeconds) / 60, 0))} min
                      </strong>
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
                  <button
                    onClick={() => setIsAddExerciseModalOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-surface-container hover:bg-surface-container-high text-on-surface rounded-xl font-label-md text-label-md font-medium transition-all cursor-pointer"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-base text-primary">add</span>
                    <span>Añadir</span>
                  </button>
                  <button
                    onClick={handleStartLiveSession}
                    disabled={isStartingWorkout}
                    className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-label-md text-label-md font-medium shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    type="button"
                  >
                    <span className="material-symbols-outlined text-lg">
                      {isStartingWorkout ? 'sync' : 'play_arrow'}
                    </span>
                    <span>{isStartingWorkout ? 'Iniciando...' : 'Lanzar Sesión en Vivo'}</span>
                  </button>
                </div>
              </div>

              {/* Exercises List */}
              {currentDay.exercises.length === 0 ? (
                <div className="bg-surface-container-lowest rounded-2xl p-10 shadow-xs border border-surface-container/50 text-center flex flex-col items-center gap-3">
                  <span className="w-14 h-14 rounded-full bg-surface-container-low flex items-center justify-center material-symbols-outlined text-3xl text-secondary">
                    {currentDay.isRestDay ? 'bed' : 'sports_gymnastics'}
                  </span>
                  <div className="flex flex-col">
                    <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
                      {currentDay.isRestDay
                        ? 'Día de Descanso Activo / Recuperación'
                        : 'No hay ejercicios programados para este día'}
                    </h3>
                    <p className="font-body-md text-body-md text-on-surface-variant text-sm mt-1 max-w-md">
                      {currentDay.isRestDay
                        ? 'Dedica esta jornada a caminatas en Zona 2, liberación miofascial con foam roller y movilidad articular.'
                        : 'Añade ejercicios desde el catálogo para estructurar tu sesión de entrenamiento.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsAddExerciseModalOpen(true)}
                    className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary font-label-md text-label-md font-bold shadow-xs hover:bg-primary-container cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-base">add</span>
                    <span>Añadir Ejercicio al Día</span>
                  </button>
                </div>
              ) : (
                currentDay.exercises.map((cfg, index) => {
                  const exercise = getExerciseById(cfg.exerciseId);
                  const isFirst = index === 0;
                  const isLast = index === currentDay.exercises.length - 1;

                  return (
                    <div
                      key={cfg.id}
                      className="bg-surface-container-lowest rounded-2xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-md hover:shadow-md transition-shadow relative"
                    >
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-space-sm">
                        <div className="flex items-start gap-space-md">
                          <div className="w-10 h-10 rounded-xl bg-surface-container-low flex items-center justify-center font-metric-md text-metric-md font-bold text-primary shrink-0 shadow-xs border border-surface-container">
                            {cfg.orderIndex}
                          </div>
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm font-semibold capitalize">
                                {exercise?.movementPattern.replace('_', ' ') || 'Compuesto'}
                              </span>
                              {cfg.tempo && (
                                <span className="font-code-data text-code-data text-on-surface-variant">
                                  Tempo: {cfg.tempo}
                                </span>
                              )}
                              <span className="font-code-data text-code-data text-on-surface-variant capitalize">
                                {exercise?.equipment || 'Equipamiento libre'}
                              </span>
                            </div>
                            <h3 className="font-headline-md text-headline-md text-on-surface font-bold tracking-tight">
                              {exercise?.name || cfg.exerciseId}
                            </h3>
                            <p className="font-body-md text-body-md text-on-surface-variant text-sm">
                              Grupo principal:{' '}
                              <strong className="capitalize text-on-surface font-medium">
                                {exercise?.muscleGroup}
                              </strong>
                              {exercise?.secondaryMuscles && exercise.secondaryMuscles.length > 0 && (
                                <span>
                                  {' '}
                                  • Sinergistas:{' '}
                                  {exercise.secondaryMuscles.map(m => m).join(', ')}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>

                        {/* Reordering & Card Controls */}
                        <div className="flex items-center gap-1 self-end md:self-start">
                          <button
                            onClick={() => reorderExercisesInRoutineDay(activeRoutine.id, currentDay.id, index, index - 1)}
                            disabled={isFirst}
                            className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Mover arriba"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-lg">arrow_upward</span>
                          </button>
                          <button
                            onClick={() => reorderExercisesInRoutineDay(activeRoutine.id, currentDay.id, index, index + 1)}
                            disabled={isLast}
                            className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                            title="Mover abajo"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-lg">arrow_downward</span>
                          </button>
                          <button
                            onClick={() => setEditingConfig(cfg)}
                            className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer"
                            title="Configurar series, repeticiones y descanso"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-lg">settings</span>
                          </button>
                          <button
                            onClick={() => {
                              if (exercise?.variants && exercise.variants.length > 0) {
                                showToast(
                                  `Variantes recomendadas para ${exercise.name}: ${exercise.variants
                                    .map(v => getExerciseById(v)?.name || v)
                                    .join(', ')}`
                                );
                              } else {
                                showToast(`Explorando catálogo para sustituciones de ${exercise?.name || ''}`);
                              }
                              navigate('sustituciones');
                            }}
                            className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer"
                            title="Sustituciones biomecánicas"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-lg">swap_horiz</span>
                          </button>
                        </div>
                      </div>

                      {/* 4-Box Config Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-space-xs bg-surface-container-low p-space-sm rounded-xl border border-surface-container/40">
                        <div className="flex flex-col p-space-xs">
                          <span className="font-label-sm text-label-sm text-on-surface-variant uppercase text-[11px]">
                            Series x Reps
                          </span>
                          <span className="font-metric-md text-metric-md font-bold text-on-surface tabular-nums">
                            {cfg.sets} × {cfg.repsMin === cfg.repsMax ? cfg.repsMin : `${cfg.repsMin}-${cfg.repsMax}`}
                          </span>
                        </div>
                        <div className="flex flex-col p-space-xs">
                          <span className="font-label-sm text-label-sm text-on-surface-variant uppercase text-[11px]">
                            RIR Objetivo
                          </span>
                          <span className="font-metric-md text-metric-md font-bold text-primary tabular-nums">
                            RIR {cfg.targetRir ?? 2}
                          </span>
                        </div>
                        <div className="flex flex-col p-space-xs">
                          <span className="font-label-sm text-label-sm text-on-surface-variant uppercase text-[11px]">
                            Descanso
                          </span>
                          <div className="flex items-baseline gap-1">
                            <span className="font-metric-md text-metric-md font-bold text-on-surface tabular-nums">
                              {cfg.restSeconds}
                            </span>
                            <span className="font-label-sm text-label-sm text-on-surface-variant">
                              seg ({Math.round(cfg.restSeconds / 60 * 10) / 10} min)
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-col p-space-xs">
                          <span className="font-label-sm text-label-sm text-on-surface-variant uppercase text-[11px]">
                            Cadencia / Tempo
                          </span>
                          <span className="font-metric-md text-metric-md font-bold text-on-surface tabular-nums">
                            {cfg.tempo || '2-0-1-0'}
                          </span>
                        </div>
                      </div>

                      {/* Autoregulation Suggestion Bar (Increment 6G) */}
                      {(() => {
                        const rec = dayRecommendationsMap.get(cfg.id);
                        if (!rec) return null;
                        return (
                          <div className="bg-surface-container-low/70 p-2.5 rounded-xl border border-surface-container/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs animate-in fade-in duration-100">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-label-sm text-[11px] ${rec.actionBadge.colorClass}`}>
                                <span className="material-symbols-outlined text-xs">{rec.actionBadge.icon}</span>
                                {rec.actionBadge.label}
                              </span>
                              {rec.lastPerformance ? (
                                <span className="text-on-surface-variant font-code-data text-[11px]">
                                  Último: <strong className="text-on-surface">{rec.lastPerformance.weightKg} kg × {rec.lastPerformance.reps} reps</strong>
                                  {rec.lastPerformance.rir !== null ? ` @ RIR ${rec.lastPerformance.rir}` : ''}
                                </span>
                              ) : (
                                <span className="text-on-surface-variant text-[11px] italic">Sin historial previo</span>
                              )}
                              <span className="text-on-surface-variant hidden md:inline">•</span>
                              <span className="text-primary font-bold font-code-data text-[11px]">
                                Sugerido: {rec.suggestedWeightKg} kg × {rec.suggestedRepsMin}-{rec.suggestedRepsMax} reps
                              </span>
                              {rec.plateauStatus === 'possible_plateau' && (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-[10px]">
                                  <span className="material-symbols-outlined text-[11px]">warning</span>
                                  Estancamiento
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setSelectedRecommendation(rec);
                                setIsSuggestionModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-container-lowest hover:bg-surface-container text-primary font-semibold text-xs border border-surface-container/80 transition-colors shrink-0 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-sm">psychology</span>
                              <span>Revisar Sugerencia</span>
                            </button>
                          </div>
                        );
                      })()}

                      {/* Technical Cues / Notes */}
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-sm pt-space-xs text-on-surface-variant font-label-md text-label-md border-t border-surface-container/30">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-base text-primary shrink-0">info</span>
                          <span className="text-xs">
                            <strong>Técnica:</strong>{' '}
                            {cfg.notes || exercise?.instructions?.[0] || 'Ejecución estricta con control del punto excéntrico.'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 bg-surface-container px-2.5 py-1 rounded-lg">
                          <span className="material-symbols-outlined text-xs text-primary">fitness_center</span>
                          <span className="font-code-data text-code-data text-xs">
                            Progresión: +1.25 a 2.5 kg al superar {cfg.repsMax} reps
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>

        {/* Right Column (4 Cols): Quick Start Gym Mode & Volume Distribution */}
        <div className="lg:col-span-4 flex flex-col gap-space-md">
          {/* Gym Mode Launcher */}
          <div className="bg-primary text-on-primary rounded-2xl p-space-lg shadow-md flex flex-col gap-space-md relative overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-on-primary/10 text-on-primary font-label-sm text-label-sm font-semibold tracking-wide backdrop-blur-xs">
                <span className="material-symbols-outlined text-xs">play_arrow</span>
                MODO EN VIVO DISPONIBLE
              </span>
              <span className="font-code-data text-code-data text-on-primary/80">
                {currentDay?.dayOfWeek || 'Sesión Activa'}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="font-headline-md text-headline-md font-bold tracking-tight text-on-primary">
                Iniciar Gym Mode
              </h3>
              <p className="font-body-md text-body-md text-on-primary/90 text-sm">
                Registra cargas reales, activa cronómetro de descanso automático por serie y sincroniza con tu RPE diario.
              </p>
            </div>
            <div className="flex items-center gap-space-md bg-on-primary/10 p-space-sm rounded-xl text-on-primary">
              <div className="flex flex-col">
                <span className="font-label-sm text-label-sm text-on-primary/70 uppercase">Ejercicios</span>
                <span className="font-metric-md text-metric-md font-bold tabular-nums">
                  {currentDay?.exercises.length || 0}
                </span>
              </div>
              <div className="h-8 w-[1px] bg-on-primary/20" />
              <div className="flex flex-col">
                <span className="font-label-sm text-label-sm text-on-primary/70 uppercase">Series Total</span>
                <span className="font-metric-md text-metric-md font-bold tabular-nums">
                  {currentDay?.exercises.reduce((acc, ex) => acc + ex.sets, 0) || 0}
                </span>
              </div>
              <div className="h-8 w-[1px] bg-on-primary/20" />
              <div className="flex flex-col">
                <span className="font-label-sm text-label-sm text-on-primary/70 uppercase">Tiempo Est.</span>
                <span className="font-metric-md text-metric-md font-bold tabular-nums">
                  {Math.round((currentDay?.exercises.reduce((acc, ex) => acc + ex.sets, 0) || 0) * 3.5)}m
                </span>
              </div>
            </div>
            <button
              onClick={handleStartLiveSession}
              disabled={isStartingWorkout}
              className="w-full py-3 px-4 rounded-xl bg-surface-container-lowest text-primary hover:bg-surface-container-low font-headline-sm text-headline-sm font-bold shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              type="button"
            >
              <span className="material-symbols-outlined text-xl">
                {isStartingWorkout ? 'sync' : 'sports_gymnastics'}
              </span>
              <span>{isStartingWorkout ? 'Iniciando...' : `Comenzar Sesión ${currentDay?.shortName || ''}`}</span>
            </button>
          </div>

          {/* Muscle Volume Breakdown (Derived Dynamically) */}
          <div className="bg-surface-container-lowest rounded-2xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
            <div className="flex items-center justify-between pb-1 border-b border-surface-container/40">
              <div className="flex flex-col">
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  Volumen Semanal por Músculo
                </h3>
                <span className="font-label-sm text-label-sm text-on-surface-variant">
                  Rango óptimo hipertrofia: 12-20 series/sem
                </span>
              </div>
              <span className="material-symbols-outlined text-lg text-primary">bar_chart</span>
            </div>

            <div className="flex flex-col gap-space-sm pt-space-xs">
              {[
                { name: 'Pectoral', current: muscleBreakdown.pecho, max: 20 },
                { name: 'Espalda & Dorsales', current: muscleBreakdown.espalda, max: 20 },
                { name: 'Cuádriceps', current: muscleBreakdown.cuadriceps, max: 20 },
                { name: 'Isquios & Glúteos', current: muscleBreakdown.isquiosGluteos, max: 20 },
                { name: 'Deltoides & Brazos', current: muscleBreakdown.hombrosBrazos, max: 20 },
                { name: 'Core & Abdomen', current: muscleBreakdown.core, max: 15 },
              ].map(m => {
                const pct = Math.min(100, Math.round((m.current / m.max) * 100));
                return (
                  <div key={m.name} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between font-label-md text-label-md">
                      <span className="font-medium text-on-surface text-xs">{m.name}</span>
                      <span className="font-code-data text-code-data tabular-nums text-on-surface-variant text-xs">
                        <strong className="text-primary font-semibold">{m.current}</strong> / {m.max} series
                      </span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-surface-container-low overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-2.5 rounded-xl bg-surface-container-low text-on-surface-variant font-label-sm text-label-sm flex items-center gap-2 border border-surface-container/40 text-xs">
              <span className="material-symbols-outlined text-sm text-primary shrink-0">check_circle</span>
              <span>Cálculo matemático derivado en tiempo real de los ejercicios asignados.</span>
            </div>
          </div>

          {/* Overload Rules Card */}
          <div className="bg-surface-container-lowest rounded-2xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
            <div className="flex items-center gap-space-xs pb-1 border-b border-surface-container/40">
              <span className="material-symbols-outlined text-primary text-xl">psychology</span>
              <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold">
                Reglas Maestras de Sobrecarga
              </h3>
            </div>
            <div className="flex flex-col gap-space-sm text-on-surface-variant font-body-md text-body-md text-xs">
              <div className="flex items-start gap-space-xs p-space-xs rounded-xl bg-surface-container-low border border-surface-container/40">
                <span className="material-symbols-outlined text-base text-primary shrink-0 mt-0.5">add_circle</span>
                <div className="flex flex-col">
                  <span className="font-semibold text-on-surface text-label-md">Criterio de Aumento (+1.25 a +2.5 kg):</span>
                  <span>Solo cuando alcances el límite superior de reps en todas las series con un RIR ≥ 1 en la última serie.</span>
                </div>
              </div>

              <div className="flex items-start gap-space-xs p-space-xs rounded-xl bg-surface-container-low border border-surface-container/40">
                <span className="material-symbols-outlined text-base text-primary shrink-0 mt-0.5">published_with_changes</span>
                <div className="flex flex-col">
                  <span className="font-semibold text-on-surface text-label-md">Autorregulación Diaria:</span>
                  <span>Si el sueño o fatiga sitúan el RPE &gt; 9.5 prematuramente, reduce un 5% la carga de trabajo manteniendo técnica estricta.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Modals */}
      {currentDay && (
        <AddExerciseToRoutineModal
          isOpen={isAddExerciseModalOpen}
          onClose={() => setIsAddExerciseModalOpen(false)}
          day={currentDay}
          onAddExercise={(exerciseId, config) => addExerciseToRoutineDay(activeRoutine.id, currentDay.id, exerciseId, config)}
        />
      )}

      {editingConfig && currentDay && (
        <EditRoutineExerciseModal
          isOpen={!!editingConfig}
          onClose={() => setEditingConfig(null)}
          config={editingConfig}
          onSave={updates => updateRoutineExerciseConfig(activeRoutine.id, currentDay.id, editingConfig.id, updates)}
          onDelete={() => removeExerciseFromRoutineDay(activeRoutine.id, currentDay.id, editingConfig.id)}
        />
      )}

      <ManageRoutinesModal
        isOpen={isManageModalOpen}
        onClose={() => setIsManageModalOpen(false)}
        routines={workoutRoutines}
        activeRoutineId={activeRoutineId}
        onSelectRoutine={id => setActiveRoutineId(id)}
        onCreateFromTemplate={(tplId, name) => createRoutineFromTemplate(tplId, name)}
        onRenameRoutine={(id, newName) => updateWorkoutRoutine(id, { name: newName })}
        onDeleteRoutine={id => deleteWorkoutRoutine(id)}
      />

      {/* Autoregulation Suggestion Modal (Increment 6G) */}
      <AutoregulationSuggestionModal
        isOpen={isSuggestionModalOpen}
        onClose={() => {
          setIsSuggestionModalOpen(false);
          setSelectedRecommendation(null);
        }}
        recommendation={selectedRecommendation}
        routineId={activeRoutine.id}
        dayId={currentDay?.id || ''}
        onApply={handleApplyRecommendation}
        onShowToast={showToast}
      />

      {/* Deload Assistant Modal (Increment 6G) */}
      <DeloadAssistantModal
        isOpen={isDeloadModalOpen}
        onClose={() => setIsDeloadModalOpen(false)}
        activeRoutine={activeRoutine}
        onApplyDeload={handleApplyDeload}
        onShowToast={showToast}
      />
    </div>
  );
};
