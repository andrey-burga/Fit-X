import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { testConnection } from '../firebase';
import { MealMoment, MealLogItem } from '../types';
import {
  getLocalDateString,
  formatSpanishDate,
  formatTimeOnly,
  getChartDayBuckets,
} from '../services/dateUtils';
import { MesocycleRoutine } from '../types/mesocycle';
import {
  generateNutritionalPeriodizationRecommendation,
  applyPeriodizationToBiometrics,
  NutritionalPeriodizationResult,
} from '../services/nutritionalPeriodizationService';

const MOMENT_ICONS: Record<MealMoment, string> = {
  desayuno: 'wb_twilight',
  almuerzo: 'sunny',
  merienda: 'local_cafe',
  cena: 'bedtime',
  snack: 'nutrition',
};

const MOMENT_LABELS: Record<MealMoment, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Almuerzo',
  merienda: 'Merienda',
  cena: 'Cena',
  snack: 'Snack / Refrigerio',
};

const STANDARD_MOMENTS: MealMoment[] = ['desayuno', 'almuerzo', 'merienda', 'cena'];

export const NutritionalDashboardView: React.FC = () => {
  const {
    navigate,
    openMealDrawer,
    showToast,
    selectedDaySummary,
    biometrics,
    hasBiometricsConfigured,
    mealLogs,
    selectedDate,
    setSelectedDate,
    selectedDateFormatted,
    groceries,
    currentUser,
    athletePreferences,
    activeRoutine,
    workoutRoutines,
    executedWorkoutsHistory,
    updateBiometrics,
    revertToPreviousBiometrics,
  } = useApp();

  const [selectedRange, setSelectedRange] = useState<'week' | '14d'>('week');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPeriodizationConfirmModalOpen, setIsPeriodizationConfirmModalOpen] = useState(false);
  const [isApplyingPeriodization, setIsApplyingPeriodization] = useState(false);
  const [showCarbCyclingDetails, setShowCarbCyclingDetails] = useState(false);
  const [dietBreakSelectedInUI, setDietBreakSelectedInUI] = useState(false);
  const [isRevertConfirmModalOpen, setIsRevertConfirmModalOpen] = useState(false);
  const [isRevertingPeriodization, setIsRevertingPeriodization] = useState(false);

  // Active mesocycle routine detection
  const activeMesocycle = useMemo(() => {
    if (activeRoutine && (activeRoutine as MesocycleRoutine).isMesocycle) {
      return activeRoutine as MesocycleRoutine;
    }
    const found = workoutRoutines.find(r => (r as MesocycleRoutine).isMesocycle);
    return found ? (found as MesocycleRoutine) : null;
  }, [activeRoutine, workoutRoutines]);

  // Actual athlete goal preserving definition and maintenance
  const athleteGoal = useMemo(() => {
    return (
      activeMesocycle?.mesocycleConfig?.athleteGoal ||
      athletePreferences?.trainingGoal ||
      'hipertrofia'
    );
  }, [activeMesocycle, athletePreferences]);

  // Intelligent Nutritional Periodization Recommendation
  const periodizationRecommendation = useMemo<NutritionalPeriodizationResult>(() => {
    return generateNutritionalPeriodizationRecommendation({
      athleteGoal,
      biometrics,
      activeMesocycle,
      executedWorkoutsHistory,
      dietBreakOptionSelected: dietBreakSelectedInUI,
    });
  }, [athleteGoal, biometrics, activeMesocycle, executedWorkoutsHistory, dietBreakSelectedInUI]);

  const handleApplyPeriodization = async () => {
    if (!periodizationRecommendation.canAutoApply) {
      showToast('No se pueden aplicar metas automáticas sin datos biométricos completos.', 'warning');
      return;
    }
    setIsApplyingPeriodization(true);
    try {
      const updatedBio = applyPeriodizationToBiometrics(biometrics, periodizationRecommendation);
      await updateBiometrics(updatedBio);
      showToast('¡Metas nutricionales periodizadas actualizadas con éxito!', 'success');
      setIsPeriodizationConfirmModalOpen(false);
    } catch (err: any) {
      showToast('Error al actualizar las metas: ' + (err.message || 'Error desconocido'), 'warning');
    } finally {
      setIsApplyingPeriodization(false);
    }
  };

  const handleRevertPeriodization = async () => {
    setIsRevertingPeriodization(true);
    try {
      const ok = await revertToPreviousBiometrics();
      if (ok) {
        showToast('¡Metas nutricionales revertidas a los valores previos con éxito!', 'success');
        setIsRevertConfirmModalOpen(false);
      } else {
        showToast('No se encontraron metas previas para revertir.', 'warning');
      }
    } catch (err: any) {
      showToast('Error al revertir metas: ' + (err.message || 'Error desconocido'), 'warning');
    } finally {
      setIsRevertingPeriodization(false);
    }
  };

  const handleSyncExcel = async () => {
    setIsSyncing(true);
    showToast('Sincronizando con Cloud Firestore...');
    try {
      await testConnection();
      setIsSyncing(false);
      showToast('¡Datos consolidados y sincronizados en Cloud Firestore con éxito!', 'success');
    } catch {
      setIsSyncing(false);
      showToast('Sincronización completada localmente');
    }
  };

  // Target and Consumed metrics for the currently selected date
  const caloriesConsumed = selectedDaySummary.calories;
  const caloriesGoal = hasBiometricsConfigured ? biometrics.targetCalories : 0;
  const caloriesRemaining = hasBiometricsConfigured ? Math.max(0, caloriesGoal - caloriesConsumed) : 0;
  const caloriesPercentage =
    hasBiometricsConfigured && caloriesGoal > 0
      ? Math.min(100, Math.round((caloriesConsumed / caloriesGoal) * 100))
      : 0;

  // Real meals filtered for the selected date (each log appears exactly once)
  const dayMeals = useMemo(() => {
    return mealLogs.filter(m => getLocalDateString(m.dateTime) === selectedDate);
  }, [mealLogs, selectedDate]);

  // Which standard moments have been recorded today
  const recordedMomentsSet = useMemo(() => {
    return new Set(dayMeals.map(m => m.moment));
  }, [dayMeals]);

  // Dynamic Chart Days calculated purely from stored meal logs
  const chartDays = useMemo(() => {
    const buckets = getChartDayBuckets(selectedDate, selectedRange);

    return buckets.map(bucket => {
      const bucketMeals = mealLogs.filter(m => getLocalDateString(m.dateTime) === bucket.dateStr);
      let kcal = 0;
      let p = 0;
      let c = 0;
      let f = 0;

      bucketMeals.forEach(log => {
        kcal += log.calories || 0;
        p += log.protein || 0;
        c += log.carbs || 0;
        f += log.fats || 0;
      });

      const totalMacroG = p + c + f;
      const pPct = totalMacroG > 0 ? (p / totalMacroG) * 100 : 0;
      const cPct = totalMacroG > 0 ? (c / totalMacroG) * 100 : 0;
      const fPct = totalMacroG > 0 ? (f / totalMacroG) * 100 : 0;

      const hasLogs = bucketMeals.length > 0;
      // Proportional bar height relative to goal or 2400 kcal
      const maxReference = Math.max(caloriesGoal || 2200, 2000);
      const heightPercent = hasLogs ? Math.max(12, Math.min(95, Math.round((kcal / maxReference) * 88))) : 12;

      return {
        day: bucket.dayShort,
        date: bucket.dateShort,
        dateStr: bucket.dateStr,
        kcal: Math.round(kcal),
        p: Math.round(pPct),
        c: Math.round(cPct),
        f: Math.round(fPct),
        height: `${heightPercent}%`,
        empty: !hasLogs,
        active: bucket.isCurrentDay,
        mealsCount: bucketMeals.length,
      };
    });
  }, [mealLogs, selectedDate, selectedRange, caloriesGoal]);

  // Real average calculation for days with recorded meals in the active range
  const chartAverage = useMemo(() => {
    const activeDays = chartDays.filter(d => !d.empty);
    if (activeDays.length === 0) return 0;
    const totalKcal = activeDays.reduce((acc, d) => acc + d.kcal, 0);
    return Math.round(totalKcal / activeDays.length);
  }, [chartDays]);

  // Moment Distribution Breakdown for selected date
  const momentBreakdown = useMemo(() => {
    const totals: Record<MealMoment, { kcal: number; count: number }> = {
      desayuno: { kcal: 0, count: 0 },
      almuerzo: { kcal: 0, count: 0 },
      merienda: { kcal: 0, count: 0 },
      cena: { kcal: 0, count: 0 },
      snack: { kcal: 0, count: 0 },
    };

    dayMeals.forEach(m => {
      if (totals[m.moment]) {
        totals[m.moment].kcal += m.calories || 0;
        totals[m.moment].count += 1;
      }
    });

    const dayKcal = selectedDaySummary.calories;

    return {
      desayuno: {
        ...totals.desayuno,
        pct: dayKcal > 0 ? Math.round((totals.desayuno.kcal / dayKcal) * 100) : 0,
      },
      almuerzo: {
        ...totals.almuerzo,
        pct: dayKcal > 0 ? Math.round((totals.almuerzo.kcal / dayKcal) * 100) : 0,
      },
      merienda: {
        ...totals.merienda,
        pct: dayKcal > 0 ? Math.round((totals.merienda.kcal / dayKcal) * 100) : 0,
      },
      cena: {
        ...totals.cena,
        pct: dayKcal > 0 ? Math.round((totals.cena.kcal / dayKcal) * 100) : 0,
      },
      snack: {
        ...totals.snack,
        pct: dayKcal > 0 ? Math.round((totals.snack.kcal / dayKcal) * 100) : 0,
      },
    };
  }, [dayMeals, selectedDaySummary.calories]);

  // Donut SVG circumference and stroke slices
  const donutSlices = useMemo(() => {
    const circumference = 238.8; // 2 * pi * 38
    const total = selectedDaySummary.calories;
    if (total <= 0) {
      return {
        desayuno: { strokeDasharray: `0 ${circumference}`, strokeDashoffset: '0' },
        almuerzo: { strokeDasharray: `0 ${circumference}`, strokeDashoffset: '0' },
        merienda: { strokeDasharray: `0 ${circumference}`, strokeDashoffset: '0' },
        cena: { strokeDasharray: `0 ${circumference}`, strokeDashoffset: '0' },
      };
    }

    const dLen = (momentBreakdown.desayuno.kcal / total) * circumference;
    const aLen = (momentBreakdown.almuerzo.kcal / total) * circumference;
    const mLen = (momentBreakdown.merienda.kcal / total) * circumference;
    const cLen = (momentBreakdown.cena.kcal / total) * circumference;

    return {
      desayuno: {
        strokeDasharray: `${dLen.toFixed(1)} ${circumference}`,
        strokeDashoffset: '0',
      },
      almuerzo: {
        strokeDasharray: `${aLen.toFixed(1)} ${circumference}`,
        strokeDashoffset: `-${dLen.toFixed(1)}`,
      },
      merienda: {
        strokeDasharray: `${mLen.toFixed(1)} ${circumference}`,
        strokeDashoffset: `-${(dLen + aLen).toFixed(1)}`,
      },
      cena: {
        strokeDasharray: `${cLen.toFixed(1)} ${circumference}`,
        strokeDashoffset: `-${(dLen + aLen + mLen).toFixed(1)}`,
      },
    };
  }, [selectedDaySummary.calories, momentBreakdown]);

  const pendingGroceriesCount = useMemo(() => {
    return groceries.filter(g => g.status === 'pending').length;
  }, [groceries]);

  return (
    <div className="p-4 sm:p-gutter-desktop flex flex-col gap-space-lg max-w-[1440px] mx-auto w-full animate-in fade-in duration-150">
      {/* Synchronization & Status Top Banner */}
      <div className="bg-surface-container-low rounded-xl p-space-md shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-space-md border border-surface-container">
        <div className="flex items-center gap-space-md">
          <div className="w-10 h-10 rounded-lg bg-surface-container-lowest flex items-center justify-center text-primary shadow-xs shrink-0">
            <span className="material-symbols-outlined text-xl">vital_signs</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-space-sm flex-wrap">
              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                ¡Hola, {currentUser?.name || 'Atleta'}!
              </span>
              <span className="font-label-sm text-label-sm bg-primary-fixed text-on-primary-fixed px-space-xs py-0.5 rounded-full font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                {currentUser?.goal === 'perdida_grasa'
                  ? 'Objetivo: Pérdida de Grasa'
                  : currentUser?.goal === 'mantenimiento'
                  ? 'Objetivo: Mantenimiento'
                  : currentUser?.goal === 'rendimiento'
                  ? 'Objetivo: Rendimiento'
                  : currentUser?.goal === 'salud_general'
                  ? 'Objetivo: Salud General'
                  : 'Objetivo: Ganancia Muscular'}
              </span>
              <span className="text-xs font-mono font-medium text-primary">
                ({biometrics.targetCalories} kcal / día)
              </span>
            </div>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Registros y balance del <strong>{selectedDateFormatted}</strong>. Tus metas metabólicas y agregados se sincronizan en tiempo real.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-space-md self-end md:self-auto shrink-0">
          <div className="text-right hidden sm:flex flex-col">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
              Fecha Activa
            </span>
            <span className="font-code-data text-code-data text-on-surface flex items-center gap-1 font-semibold">
              <span className="material-symbols-outlined text-xs text-primary">calendar_today</span> {selectedDate}
            </span>
          </div>
          <button
            onClick={handleSyncExcel}
            disabled={isSyncing}
            className="flex items-center gap-space-xs px-space-md py-2 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg font-medium transition-colors shadow-sm cursor-pointer"
            type="button"
          >
            <span className={`material-symbols-outlined text-base ${isSyncing ? 'animate-spin' : ''}`}>
              {isSyncing ? 'sync' : 'upload_file'}
            </span>
            <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar Cloud Firestore'}</span>
          </button>
        </div>
      </div>

      {/* ======================================================== */}
      {/* INCREMENTO 7C: PERIODIZACIÓN NUTRICIONAL ASISTIDA       */}
      {/* ======================================================== */}
      <div className="bg-surface-container-low rounded-xl p-space-md md:p-space-lg border border-primary/20 shadow-xs flex flex-col gap-space-md relative overflow-hidden">
        {/* Subtle accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-secondary to-tertiary" />

        {/* Header row */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
          <div className="flex items-start gap-space-sm">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-xl">auto_graph</span>
            </div>
            <div>
              <div className="flex items-center gap-space-xs flex-wrap">
                <span className="font-headline-sm text-headline-sm text-on-surface font-bold">
                  Periodización Nutricional Asistida
                </span>
                {periodizationRecommendation.isDeloadWeek ? (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-tertiary-container text-on-tertiary-container flex items-center gap-1">
                    <span className="material-symbols-outlined text-xs">healing</span>
                    Semana de Descarga (Diet Break / Recuperación)
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/15 text-primary flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                    Fase Activa: {periodizationRecommendation.mesocyclePhase}
                  </span>
                )}
              </div>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {activeMesocycle
                  ? `Sincronizada con mesociclo: "${activeMesocycle.name}" (Objetivo real: ${athleteGoal.toUpperCase()})`
                  : `Configuración basada en tu objetivo de perfil (${athleteGoal.toUpperCase()})`}
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-space-xs self-start md:self-auto flex-wrap">
            {biometrics.lastAppliedPeriodization?.previousTargets && (
              <button
                type="button"
                onClick={() => setIsRevertConfirmModalOpen(true)}
                className="px-3 py-1.5 rounded-lg border border-tertiary/40 hover:bg-surface-container text-tertiary text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Revertir a las metas previas a la última periodización"
              >
                <span className="material-symbols-outlined text-sm">history</span>
                <span>Revertir a Metas Previas</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowCarbCyclingDetails(prev => !prev)}
              className="px-3 py-1.5 rounded-lg border border-outline-variant hover:bg-surface-container text-on-surface text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <span className="material-symbols-outlined text-sm text-secondary">sync_alt</span>
              <span>{showCarbCyclingDetails ? 'Ocultar Ciclado' : 'Ver Ciclado de Carbos'}</span>
            </button>
            <button
              type="button"
              disabled={!periodizationRecommendation.canAutoApply}
              onClick={() => setIsPeriodizationConfirmModalOpen(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs ${
                periodizationRecommendation.canAutoApply
                  ? 'bg-primary hover:bg-primary/90 text-on-primary cursor-pointer'
                  : 'bg-surface-container-high text-on-surface-variant opacity-50 cursor-not-allowed'
              }`}
              title={
                periodizationRecommendation.canAutoApply
                  ? 'Aplicar propuesta a las metas activas'
                  : 'Completa tu perfil biométrico para aplicar metas personalizadas'
              }
            >
              <span className="material-symbols-outlined text-sm">tune</span>
              <span>Aplicar a mis Metas</span>
            </button>
          </div>
        </div>

        {/* Insufficient Biometric Data Warning Banner */}
        {!periodizationRecommendation.hasSufficientData && (
          <div className="p-space-sm rounded-lg bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-sm">
            <div className="flex items-start gap-space-xs text-xs text-amber-200">
              <span className="material-symbols-outlined text-amber-400 text-base shrink-0 mt-0.5">warning</span>
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-amber-300">Datos Antropométricos Incompletos:</span>
                <span>{periodizationRecommendation.referenceNotice}</span>
                <span className="text-[11px] text-amber-300/80">
                  Parámetros faltantes: <strong>{periodizationRecommendation.missingFields.join(', ')}</strong>. La aplicación automática se encuentra desactivada por seguridad.
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('perfil-atleta')}
              className="px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-600 text-black text-xs font-semibold shrink-0 cursor-pointer transition-colors self-end sm:self-auto"
            >
              Completar Perfil
            </button>
          </div>
        )}

        {/* Voluntary Diet Break Section for Deload in Definition */}
        {periodizationRecommendation.dietBreakSuggestion && (
          <div className="p-space-sm rounded-lg bg-surface-container-lowest border border-tertiary/40 flex flex-col gap-space-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-tertiary text-base shrink-0">healing</span>
                <span className="font-semibold text-on-surface text-xs">
                  Semana de Descarga: Opción de Pausa Dietética (Diet Break Voluntario)
                </span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-on-surface bg-surface-container px-2 py-1 rounded">
                <span>{dietBreakSelectedInUI ? 'Diet Break Activado (TDEE Mantenimiento)' : 'Mantener Déficit de Definición'}</span>
                <input
                  type="checkbox"
                  checked={dietBreakSelectedInUI}
                  onChange={(e) => setDietBreakSelectedInUI(e.target.checked)}
                  className="w-4 h-4 rounded text-tertiary focus:ring-tertiary accent-tertiary cursor-pointer"
                />
              </label>
            </div>
            <p className="text-[11px] text-on-surface-variant">
              {periodizationRecommendation.dietBreakSuggestion.rationale}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-1 text-[11px] text-on-surface-variant">
              <div className="p-2 rounded bg-surface-container-low border border-surface-container">
                <span className="font-semibold text-primary block mb-1">Beneficios demostrados:</span>
                <ul className="list-disc pl-3 space-y-0.5">
                  {periodizationRecommendation.dietBreakSuggestion.pros.map((p, idx) => (
                    <li key={idx}>{p}</li>
                  ))}
                </ul>
              </div>
              <div className="p-2 rounded bg-surface-container-low border border-surface-container">
                <span className="font-semibold text-secondary block mb-1">Limitaciones reales:</span>
                <ul className="list-disc pl-3 space-y-0.5">
                  {periodizationRecommendation.dietBreakSuggestion.limitations.map((l, idx) => (
                    <li key={idx}>{l}</li>
                  ))}
                </ul>
              </div>
              <div className="p-2 rounded bg-surface-container-low border border-surface-container">
                <span className="font-semibold text-tertiary block mb-1">Criterios de aplicación:</span>
                <ul className="list-disc pl-3 space-y-0.5">
                  {periodizationRecommendation.dietBreakSuggestion.conditions.map((c, idx) => (
                    <li key={idx}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Comparison Grid: Actual vs Propuesta */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-space-sm">
          {/* Calorías */}
          <div className="bg-surface-container-lowest p-3 rounded-lg border border-surface-container/60 flex flex-col justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">Calorías Diarias</span>
            <div className="my-1">
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold font-mono text-on-surface">
                  {periodizationRecommendation.proposedPlan.targetCalories}
                </span>
                <span className="text-xs text-on-surface-variant">kcal</span>
              </div>
              <div className="text-[11px] text-on-surface-variant flex items-center gap-1 mt-0.5">
                <span>Actual: {periodizationRecommendation.currentPlan.targetCalories} kcal</span>
                {periodizationRecommendation.proposedPlan.targetCalories !== periodizationRecommendation.currentPlan.targetCalories && (
                  <span className={`font-semibold ${periodizationRecommendation.proposedPlan.targetCalories > periodizationRecommendation.currentPlan.targetCalories ? 'text-primary' : 'text-secondary'}`}>
                    ({periodizationRecommendation.proposedPlan.targetCalories > periodizationRecommendation.currentPlan.targetCalories ? '+' : ''}
                    {periodizationRecommendation.proposedPlan.targetCalories - periodizationRecommendation.currentPlan.targetCalories})
                  </span>
                )}
              </div>
            </div>
            <span className="text-[10px] text-primary font-medium">
              Delta: {periodizationRecommendation.proposedPlan.targetDeltaKcal >= 0 ? `+${periodizationRecommendation.proposedPlan.targetDeltaKcal}` : periodizationRecommendation.proposedPlan.targetDeltaKcal} kcal/TDEE
            </span>
          </div>

          {/* Proteínas */}
          <div className="bg-surface-container-lowest p-3 rounded-lg border border-surface-container/60 flex flex-col justify-between">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">Proteínas</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-container-high text-primary font-medium">
                {periodizationRecommendation.proposedPlan.proteinBasis === 'fat_free_mass'
                  ? 'Base: FFM (Masa Magra)'
                  : 'Base: Peso Total'}
              </span>
            </div>
            <div className="my-1">
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold font-mono text-primary">
                  {periodizationRecommendation.proposedPlan.targetProteinG}
                </span>
                <span className="text-xs text-on-surface-variant">g</span>
              </div>
              <div className="text-[11px] text-on-surface-variant flex items-center gap-1 mt-0.5">
                <span>Actual: {periodizationRecommendation.currentPlan.targetProteinG}g</span>
                <span className="font-semibold text-primary">
                  ({periodizationRecommendation.proposedPlan.proteinPerKg} g/kg)
                </span>
              </div>
            </div>
            <span className="text-[10px] text-on-surface-variant">
              {Math.round(periodizationRecommendation.proposedPlan.targetProteinG * 4)} kcal ({Math.round((periodizationRecommendation.proposedPlan.targetProteinG * 4 / periodizationRecommendation.proposedPlan.targetCalories) * 100)}%)
            </span>
          </div>

          {/* Carbohidratos */}
          <div className="bg-surface-container-lowest p-3 rounded-lg border border-surface-container/60 flex flex-col justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">Carbohidratos</span>
            <div className="my-1">
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold font-mono text-secondary">
                  {periodizationRecommendation.proposedPlan.targetCarbsG}
                </span>
                <span className="text-xs text-on-surface-variant">g</span>
              </div>
              <div className="text-[11px] text-on-surface-variant flex items-center gap-1 mt-0.5">
                <span>Actual: {periodizationRecommendation.currentPlan.targetCarbsG}g</span>
                {periodizationRecommendation.proposedPlan.targetCarbsG !== periodizationRecommendation.currentPlan.targetCarbsG && (
                  <span className="font-semibold text-secondary">
                    ({periodizationRecommendation.proposedPlan.targetCarbsG > periodizationRecommendation.currentPlan.targetCarbsG ? '+' : ''}
                    {periodizationRecommendation.proposedPlan.targetCarbsG - periodizationRecommendation.currentPlan.targetCarbsG}g)
                  </span>
                )}
              </div>
            </div>
            <span className="text-[10px] text-on-surface-variant">
              {Math.round(periodizationRecommendation.proposedPlan.targetCarbsG * 4)} kcal ({Math.round((periodizationRecommendation.proposedPlan.targetCarbsG * 4 / periodizationRecommendation.proposedPlan.targetCalories) * 100)}%)
            </span>
          </div>

          {/* Grasas */}
          <div className="bg-surface-container-lowest p-3 rounded-lg border border-surface-container/60 flex flex-col justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">Grasas Saludables</span>
            <div className="my-1">
              <div className="flex items-baseline gap-1">
                <span className="text-xl font-bold font-mono text-tertiary">
                  {periodizationRecommendation.proposedPlan.targetFatG}
                </span>
                <span className="text-xs text-on-surface-variant">g</span>
              </div>
              <div className="text-[11px] text-on-surface-variant flex items-center gap-1 mt-0.5">
                <span>Actual: {periodizationRecommendation.currentPlan.targetFatG}g</span>
                <span className="font-semibold text-tertiary">
                  ({periodizationRecommendation.proposedPlan.fatPerKg} g/kg)
                </span>
              </div>
            </div>
            <span className="text-[10px] text-on-surface-variant">
              {Math.round(periodizationRecommendation.proposedPlan.targetFatG * 9)} kcal ({Math.round((periodizationRecommendation.proposedPlan.targetFatG * 9 / periodizationRecommendation.proposedPlan.targetCalories) * 100)}%)
            </span>
          </div>
        </div>

        {/* Expandable Carb Cycling Section */}
        {showCarbCyclingDetails && (
          <div className="bg-surface-container-lowest p-space-md rounded-xl border border-outline-variant/40 flex flex-col gap-space-sm animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-lg">cyclist</span>
                <span className="font-headline-sm text-sm font-bold text-on-surface">
                  Estrategia de Ciclado de Carbohidratos por Demanda Diaria
                </span>
                {periodizationRecommendation.wasCarbCyclingModulated && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-tertiary/20 text-tertiary font-medium">
                    Distribución auto-modulada (seguridad metabólica)
                  </span>
                )}
              </div>
              <div className="text-left sm:text-right flex flex-col">
                <span className="text-xs text-on-surface-variant">
                  Media semanal real: <strong>{periodizationRecommendation.weeklyAverageCalories} kcal/día</strong>
                </span>
                <span className="text-[10px] text-primary font-semibold">
                  Conservación isocalórica semanal exacta (±{Math.abs(periodizationRecommendation.weeklyCalorieDeltaPerDay)} kcal/día vs propuesta)
                </span>
              </div>
            </div>

            {periodizationRecommendation.carbCyclingModulationReason && (
              <div className="p-2 rounded bg-tertiary/10 border border-tertiary/30 text-xs text-on-surface-variant flex items-start gap-1.5">
                <span className="material-symbols-outlined text-sm text-tertiary shrink-0 mt-0.5">shield</span>
                <span>{periodizationRecommendation.carbCyclingModulationReason}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-space-sm pt-1">
              {/* High Training Day */}
              <div className="p-3 rounded-lg bg-surface-container-low border border-surface-container flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-xs text-primary">Día de Alta Demanda</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-primary/20 text-primary font-bold">
                      +{periodizationRecommendation.dayDemandTargets.highTrainingDay.carbShiftPct}% Carbos
                    </span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant">
                    {periodizationRecommendation.dayDemandTargets.highTrainingDay.description}
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-outline-variant/30 flex items-center justify-between text-xs font-mono">
                  <span><strong>{periodizationRecommendation.dayDemandTargets.highTrainingDay.calories}</strong> kcal</span>
                  <span>P: {periodizationRecommendation.dayDemandTargets.highTrainingDay.proteinG}g</span>
                  <span className="text-primary font-bold">C: {periodizationRecommendation.dayDemandTargets.highTrainingDay.carbsG}g</span>
                  <span>G: {periodizationRecommendation.dayDemandTargets.highTrainingDay.fatG}g</span>
                </div>
              </div>

              {/* Moderate Day */}
              <div className="p-3 rounded-lg bg-surface-container-low border border-surface-container flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-xs text-on-surface">Entrenamiento Estándar</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-surface-container-high text-on-surface-variant font-bold">
                      {periodizationRecommendation.dayDemandTargets.moderateTrainingDay.carbShiftPct !== 0
                        ? `${periodizationRecommendation.dayDemandTargets.moderateTrainingDay.carbShiftPct}% Carbos`
                        : 'Base'}
                    </span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant">
                    {periodizationRecommendation.dayDemandTargets.moderateTrainingDay.description}
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-outline-variant/30 flex items-center justify-between text-xs font-mono">
                  <span><strong>{periodizationRecommendation.dayDemandTargets.moderateTrainingDay.calories}</strong> kcal</span>
                  <span>P: {periodizationRecommendation.dayDemandTargets.moderateTrainingDay.proteinG}g</span>
                  <span>C: {periodizationRecommendation.dayDemandTargets.moderateTrainingDay.carbsG}g</span>
                  <span>G: {periodizationRecommendation.dayDemandTargets.moderateTrainingDay.fatG}g</span>
                </div>
              </div>

              {/* Rest Day */}
              <div className="p-3 rounded-lg bg-surface-container-low border border-surface-container flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-xs text-secondary">Descanso / Recuperación</span>
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-secondary/20 text-secondary font-bold">
                      {periodizationRecommendation.dayDemandTargets.restRecoveryDay.carbShiftPct}% Carbos
                    </span>
                  </div>
                  <p className="text-[11px] text-on-surface-variant">
                    {periodizationRecommendation.dayDemandTargets.restRecoveryDay.description}
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-outline-variant/30 flex items-center justify-between text-xs font-mono">
                  <span><strong>{periodizationRecommendation.dayDemandTargets.restRecoveryDay.calories}</strong> kcal</span>
                  <span>P: {periodizationRecommendation.dayDemandTargets.restRecoveryDay.proteinG}g</span>
                  <span className="text-secondary font-bold">C: {periodizationRecommendation.dayDemandTargets.restRecoveryDay.carbsG}g</span>
                  <span>G: {periodizationRecommendation.dayDemandTargets.restRecoveryDay.fatG}g</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* KPI 5-Card Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-space-md">
        {/* Card 1: Calories */}
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
              Calorías Totales
            </span>
            <span className="material-symbols-outlined text-primary text-base">local_fire_department</span>
          </div>
          <div className="my-space-sm">
            <div className="flex items-baseline gap-space-xs">
              <span className="font-metric-xl text-metric-xl text-on-surface">{caloriesConsumed}</span>
              <span className="font-label-md text-label-md text-on-surface-variant">
                {hasBiometricsConfigured ? `/ ${caloriesGoal} kcal` : 'kcal'}
              </span>
            </div>
            <div className="w-full bg-surface-container-high rounded-full h-2 mt-space-xs overflow-hidden">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-500"
                style={{ width: `${caloriesPercentage}%` }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between font-label-sm text-label-sm">
            {hasBiometricsConfigured ? (
              <>
                <span className="text-primary font-medium">{caloriesPercentage}% cubierto</span>
                <span className="font-code-data text-code-data text-on-surface-variant">
                  {caloriesRemaining > 0 ? `-${caloriesRemaining} kcal rest.` : 'Meta alcanzada'}
                </span>
              </>
            ) : (
              <button
                onClick={() => navigate('configuracion-nutricional')}
                className="text-primary font-medium hover:underline text-xs"
              >
                Configurar objetivo calórico
              </button>
            )}
          </div>
        </div>

        {/* Card 2: Protein */}
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
              Proteínas
            </span>
            <span className="font-label-sm text-label-sm bg-primary-fixed text-on-primary-fixed px-1.5 py-0.5 rounded-full font-semibold">
              {hasBiometricsConfigured && selectedDaySummary.protein >= biometrics.targetProteinG * 0.9 ? 'En rango' : 'Registro'}
            </span>
          </div>
          <div className="my-space-sm">
            <div className="flex items-baseline gap-space-xs">
              <span className="font-metric-xl text-metric-xl text-on-surface">{selectedDaySummary.protein}</span>
              <span className="font-label-md text-label-md text-on-surface-variant">
                {hasBiometricsConfigured ? `/ ${biometrics.targetProteinG} g` : 'g'}
              </span>
            </div>
            <div className="w-full bg-surface-container-high rounded-full h-2 mt-space-xs overflow-hidden">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${
                    hasBiometricsConfigured && biometrics.targetProteinG > 0
                      ? Math.min(100, Math.round((selectedDaySummary.protein / biometrics.targetProteinG) * 100))
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between font-label-sm text-label-sm">
            {hasBiometricsConfigured ? (
              <>
                <span className="text-on-surface-variant">Meta: {biometrics.proteinPerKg}g/kg</span>
                <span className="font-code-data text-code-data text-primary font-medium">
                  {Math.round((selectedDaySummary.protein / biometrics.targetProteinG) * 100)}%
                </span>
              </>
            ) : (
              <span className="text-on-surface-variant text-xs">Meta pendiente</span>
            )}
          </div>
        </div>

        {/* Card 3: Carbs */}
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
              Carbohidratos
            </span>
            <span className="material-symbols-outlined text-secondary text-base">grain</span>
          </div>
          <div className="my-space-sm">
            <div className="flex items-baseline gap-space-xs">
              <span className="font-metric-xl text-metric-xl text-on-surface">{selectedDaySummary.carbs}</span>
              <span className="font-label-md text-label-md text-on-surface-variant">
                {hasBiometricsConfigured ? `/ ${biometrics.targetCarbsG} g` : 'g'}
              </span>
            </div>
            <div className="w-full bg-surface-container-high rounded-full h-2 mt-space-xs overflow-hidden">
              <div
                className="bg-secondary h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${
                    hasBiometricsConfigured && biometrics.targetCarbsG > 0
                      ? Math.min(100, Math.round((selectedDaySummary.carbs / biometrics.targetCarbsG) * 100))
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between font-label-sm text-label-sm">
            {hasBiometricsConfigured ? (
              <>
                <span className="text-on-surface-variant">Meta: {biometrics.targetCarbsG}g</span>
                <span className="font-code-data text-code-data text-on-surface-variant font-medium">
                  {Math.round((selectedDaySummary.carbs / biometrics.targetCarbsG) * 100)}%
                </span>
              </>
            ) : (
              <span className="text-on-surface-variant text-xs">Meta pendiente</span>
            )}
          </div>
        </div>

        {/* Card 4: Fats */}
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
              Grasas Saludables
            </span>
            <span className="material-symbols-outlined text-tertiary text-base">opacity</span>
          </div>
          <div className="my-space-sm">
            <div className="flex items-baseline gap-space-xs">
              <span className="font-metric-xl text-metric-xl text-on-surface">{selectedDaySummary.fats}</span>
              <span className="font-label-md text-label-md text-on-surface-variant">
                {hasBiometricsConfigured ? `/ ${biometrics.targetFatG} g` : 'g'}
              </span>
            </div>
            <div className="w-full bg-surface-container-high rounded-full h-2 mt-space-xs overflow-hidden">
              <div
                className="bg-tertiary h-2 rounded-full transition-all duration-500"
                style={{
                  width: `${
                    hasBiometricsConfigured && biometrics.targetFatG > 0
                      ? Math.min(100, Math.round((selectedDaySummary.fats / biometrics.targetFatG) * 100))
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between font-label-sm text-label-sm">
            {hasBiometricsConfigured ? (
              <>
                <span className="text-on-surface-variant">Meta: {biometrics.targetFatG}g</span>
                <span className="font-code-data text-code-data text-on-surface-variant font-medium">
                  {Math.round((selectedDaySummary.fats / biometrics.targetFatG) * 100)}%
                </span>
              </>
            ) : (
              <span className="text-on-surface-variant text-xs">Meta pendiente</span>
            )}
          </div>
        </div>

        {/* Card 5: Hydration (Honest pending status without fake records) */}
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
              Hidratación
            </span>
            <span className="material-symbols-outlined text-tertiary text-base">water_drop</span>
          </div>
          <div className="my-space-sm">
            <div className="flex items-baseline gap-space-xs">
              <span className="font-metric-xl text-metric-xl text-on-surface">--</span>
              <span className="font-label-md text-label-md text-on-surface-variant">
                / ~{(biometrics.weightKg * 0.035).toFixed(1)} L
              </span>
            </div>
            <div className="w-full bg-surface-container-high rounded-full h-2 mt-space-xs overflow-hidden">
              <div className="bg-surface-container-highest h-2 rounded-full" style={{ width: '0%' }} />
            </div>
          </div>
          <div className="flex items-center justify-between font-label-sm text-label-sm">
            <span className="text-on-surface-variant">Sin registro activo</span>
            <span className="font-label-xs text-[10px] text-tertiary font-medium bg-tertiary/10 px-1.5 py-0.5 rounded">
              Próximamente
            </span>
          </div>
        </div>
      </div>

      {/* Central Analytical Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-lg">
        {/* Chart 1: Weekly Balance */}
        <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-space-sm">
              <div className="flex flex-col">
                <div className="flex items-center gap-space-xs">
                  <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                    Balance Calórico &amp; Macros Real
                  </h3>
                  <span
                    className="material-symbols-outlined text-sm text-on-surface-variant cursor-help"
                    title="Agregaciones directas de mealLogs por fecha local"
                  >
                    info
                  </span>
                </div>
                <span className="font-label-sm text-label-sm text-on-surface-variant">
                  Kcal reales registradas vs. Objetivo ({selectedRange === 'week' ? 'Semana activa' : '14 días'})
                </span>
              </div>
              <div className="flex items-center gap-space-xs bg-surface-container-low p-1 rounded-lg">
                <button
                  onClick={() => setSelectedRange('week')}
                  className={`px-space-xs py-1 rounded font-label-sm text-label-sm transition-colors cursor-pointer ${
                    selectedRange === 'week'
                      ? 'bg-surface-container-lowest text-on-surface shadow-xs font-semibold'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                  type="button"
                >
                  Semana actual
                </button>
                <button
                  onClick={() => setSelectedRange('14d')}
                  className={`px-space-xs py-1 rounded font-label-sm text-label-sm transition-colors cursor-pointer ${
                    selectedRange === '14d'
                      ? 'bg-surface-container-lowest text-on-surface shadow-xs font-semibold'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                  type="button"
                >
                  14 días
                </button>
              </div>
            </div>

            {/* Legend */}
            <div className="flex items-center gap-space-md py-space-xs text-xs text-on-surface-variant flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-primary" />
                <span>Proteína (%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-secondary" />
                <span>Carbos (%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-tertiary" />
                <span>Grasas (%)</span>
              </div>
              {hasBiometricsConfigured && (
                <div className="flex items-center gap-1.5">
                  <span className="w-4 h-0.5 bg-outline-variant" />
                  <span>Meta ({caloriesGoal} kcal)</span>
                </div>
              )}
            </div>

            {/* Visual Chart */}
            <div className="relative w-full h-64 pt-space-md flex flex-col justify-end">
              {hasBiometricsConfigured && (
                <div className="absolute top-12 left-8 right-0 border-b border-dashed border-outline-variant/60 flex items-center justify-end z-0">
                  <span className="font-code-data text-code-data text-on-surface-variant px-1 bg-surface-container-lowest text-xs">
                    {caloriesGoal} kcal (Meta)
                  </span>
                </div>
              )}
              <div className="w-full h-full flex items-end justify-between pl-8 pr-2 gap-1.5 z-10">
                {chartDays.map((item, idx) => (
                  <div
                    key={idx}
                    onClick={() => {
                      setSelectedDate(item.dateStr);
                      showToast(`Fecha seleccionada: ${formatSpanishDate(item.dateStr)}`);
                    }}
                    title={`${item.dateStr}: ${item.empty ? 'Sin registros' : `${item.kcal} kcal (${item.mealsCount} comidas)`}`}
                    className={`flex-1 flex flex-col items-center gap-1 h-full justify-end group cursor-pointer transition-transform hover:scale-[1.02] ${
                      item.empty ? 'opacity-40 hover:opacity-75' : ''
                    }`}
                  >
                    <span
                      className={`font-code-data text-[11px] transition-opacity ${
                        item.active
                          ? 'text-primary font-bold opacity-100'
                          : 'text-on-surface opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {item.empty ? '-' : item.kcal}
                    </span>
                    <div
                      className={`w-full max-w-[34px] flex flex-col rounded-t overflow-hidden transition-all ${
                        item.empty
                          ? 'bg-surface-container-low border border-dashed border-outline-variant h-4'
                          : 'bg-surface-container-low shadow-xs'
                      } ${item.active ? 'ring-2 ring-primary ring-offset-1 ring-offset-surface-container-lowest' : ''}`}
                      style={{ height: item.empty ? '12px' : item.height }}
                    >
                      {!item.empty && (
                        <>
                          <div className="bg-tertiary w-full" style={{ height: `${item.f}%` }} />
                          <div className="bg-secondary w-full" style={{ height: `${item.c}%` }} />
                          <div className="bg-primary w-full" style={{ height: `${item.p}%` }} />
                        </>
                      )}
                    </div>
                    <div className="flex flex-col items-center">
                      <span
                        className={`font-label-sm text-label-sm font-semibold ${
                          item.active ? 'text-primary font-bold' : 'text-on-surface'
                        }`}
                      >
                        {item.day}
                      </span>
                      <span className="font-code-data text-[10px] text-on-surface-variant/80">
                        {item.date}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="pt-space-md flex items-center justify-between text-xs text-on-surface-variant border-t border-surface-container/40 mt-space-sm">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-sm text-primary">verified</span>
              {chartDays.filter(d => !d.empty).length} de {chartDays.length} días con registros en el rango
            </span>
            <span className="font-code-data text-code-data font-semibold text-on-surface">
              {chartAverage > 0 ? `Promedio: ${chartAverage.toLocaleString()} kcal/día` : 'Sin registros en el rango'}
            </span>
          </div>
        </div>

        {/* Chart 2: Consumption Moments Distribution */}
        <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between pb-space-sm">
              <div className="flex flex-col">
                <div className="flex items-center gap-space-xs">
                  <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                    Distribución por Momento de Consumo
                  </h3>
                  <span
                    className="material-symbols-outlined text-sm text-on-surface-variant cursor-help"
                    title="Porcentajes reales del día calculados sobre la ingesta guardada"
                  >
                    info
                  </span>
                </div>
                <span className="font-label-sm text-label-sm text-on-surface-variant">
                  Aporte registrado para {selectedDateFormatted}
                </span>
              </div>
              <button
                onClick={() => navigate('configuracion-nutricional')}
                className="p-1 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface cursor-pointer"
                type="button"
                title="Ajustar repartos"
              >
                <span className="material-symbols-outlined text-lg">tune</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md py-space-sm items-center">
              {/* Donut SVG */}
              <div className="flex flex-col items-center justify-center relative">
                <svg className="w-44 h-44 transform -rotate-90" viewBox="0 0 100 100">
                  <circle
                    className="text-surface-container"
                    cx="50"
                    cy="50"
                    fill="transparent"
                    r="38"
                    stroke="currentColor"
                    strokeWidth="12"
                  />
                  {selectedDaySummary.calories > 0 && (
                    <>
                      {/* Desayuno */}
                      <circle
                        className="text-primary"
                        cx="50"
                        cy="50"
                        fill="transparent"
                        r="38"
                        stroke="currentColor"
                        strokeDasharray={donutSlices.desayuno.strokeDasharray}
                        strokeDashoffset={donutSlices.desayuno.strokeDashoffset}
                        strokeWidth="12"
                      />
                      {/* Almuerzo */}
                      <circle
                        className="text-primary-container"
                        cx="50"
                        cy="50"
                        fill="transparent"
                        r="38"
                        stroke="currentColor"
                        strokeDasharray={donutSlices.almuerzo.strokeDasharray}
                        strokeDashoffset={donutSlices.almuerzo.strokeDashoffset}
                        strokeWidth="12"
                      />
                      {/* Merienda */}
                      <circle
                        className="text-secondary"
                        cx="50"
                        cy="50"
                        fill="transparent"
                        r="38"
                        stroke="currentColor"
                        strokeDasharray={donutSlices.merienda.strokeDasharray}
                        strokeDashoffset={donutSlices.merienda.strokeDashoffset}
                        strokeWidth="12"
                      />
                      {/* Cena */}
                      <circle
                        className="text-tertiary"
                        cx="50"
                        cy="50"
                        fill="transparent"
                        r="38"
                        stroke="currentColor"
                        strokeDasharray={donutSlices.cena.strokeDasharray}
                        strokeDashoffset={donutSlices.cena.strokeDashoffset}
                        strokeWidth="12"
                      />
                    </>
                  )}
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
                  <span className="font-label-sm text-[11px] text-on-surface-variant uppercase">
                    {hasBiometricsConfigured ? 'Progreso Meta' : 'Ingesta'}
                  </span>
                  <span className="font-headline-lg text-headline-lg font-bold text-on-surface">
                    {hasBiometricsConfigured ? `${caloriesPercentage}%` : `${selectedDaySummary.calories}`}
                  </span>
                  <span className="font-code-data text-xs text-primary font-semibold">
                    {recordedMomentsSet.size} de 4 tomas
                  </span>
                </div>
              </div>

              {/* Moment breakdown list */}
              <div className="flex flex-col gap-space-xs font-label-md text-label-md">
                <div className="flex items-center justify-between p-1.5 rounded hover:bg-surface-container-low transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                    <span className="text-on-surface font-medium">Desayuno</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-code-data text-code-data text-on-surface">
                      {momentBreakdown.desayuno.kcal} kcal
                    </span>
                    <span className="font-code-data text-code-data text-primary font-semibold">
                      {momentBreakdown.desayuno.pct}%
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between p-1.5 rounded hover:bg-surface-container-low transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-primary-container" />
                    <span className="text-on-surface font-medium">Almuerzo</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-code-data text-code-data text-on-surface">
                      {momentBreakdown.almuerzo.kcal} kcal
                    </span>
                    <span className="font-code-data text-code-data text-primary font-semibold">
                      {momentBreakdown.almuerzo.pct}%
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between p-1.5 rounded hover:bg-surface-container-low transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-secondary" />
                    <span className="text-on-surface font-medium">Merienda</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-code-data text-code-data text-on-surface">
                      {momentBreakdown.merienda.kcal} kcal
                    </span>
                    <span className="font-code-data text-code-data text-primary font-semibold">
                      {momentBreakdown.merienda.pct}%
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between p-1.5 rounded hover:bg-surface-container-low transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-tertiary" />
                    <span className="text-on-surface font-medium">Cena</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-code-data text-code-data text-on-surface">
                      {momentBreakdown.cena.kcal} kcal
                    </span>
                    <span className="font-code-data text-code-data text-primary font-semibold">
                      {momentBreakdown.cena.pct}%
                    </span>
                  </div>
                </div>

                {momentBreakdown.snack.count > 0 && (
                  <div className="flex items-center justify-between p-1.5 rounded hover:bg-surface-container-low transition-colors">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-surface-container-highest" />
                      <span className="text-on-surface font-medium">Snacks</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-code-data text-code-data text-on-surface">
                        {momentBreakdown.snack.kcal} kcal
                      </span>
                      <span className="font-code-data text-code-data text-primary font-semibold">
                        {momentBreakdown.snack.pct}%
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-space-md flex items-center justify-between text-xs text-on-surface-variant border-t border-surface-container/40 mt-space-sm">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-sm text-primary">pie_chart</span>
              Total del día seleccionado: {selectedDaySummary.calories} kcal
            </span>
            <span className="font-code-data text-code-data text-primary">
              {selectedDaySummary.mealCount} alimento(s) registrado(s)
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Section: Today's Logged Meals & Quick Navigation Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-lg">
        {/* Left Column (2/3): Today's Meals */}
        <div className="lg:col-span-2 bg-surface-container-lowest p-space-lg rounded-xl shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-space-sm">
              <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                Registro de Comidas del Día
              </h3>
              <span className="font-label-sm text-label-sm bg-surface-container-low text-on-surface font-medium px-2.5 py-0.5 rounded-full border border-surface-container">
                {selectedDateFormatted}
              </span>
            </div>
            <button
              onClick={() => openMealDrawer()}
              className="flex items-center gap-1 text-primary hover:text-primary-container font-label-md text-label-md font-medium transition-colors cursor-pointer"
              type="button"
            >
              <span className="material-symbols-outlined text-base">add_circle</span>
              <span>Añadir alimento</span>
            </button>
          </div>

          <div className="flex flex-col gap-space-sm">
            {dayMeals.length === 0 ? (
              /* Estado Vacío Claro */
              <div className="p-space-lg bg-surface-container-low/60 rounded-xl border border-dashed border-outline-variant/60 flex flex-col items-center justify-center text-center gap-space-sm py-10">
                <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant">
                  <span className="material-symbols-outlined text-2xl">restaurant</span>
                </div>
                <div className="flex flex-col gap-0.5 max-w-sm">
                  <span className="font-headline-sm text-headline-sm font-semibold text-on-surface">
                    Sin ingestas registradas para esta fecha
                  </span>
                  <p className="font-body-md text-body-md text-on-surface-variant text-sm">
                    No se encontraron alimentos registrados para el {selectedDateFormatted}. Pulsa en el botón para añadir tu primera comida.
                  </p>
                </div>
                <button
                  onClick={() => openMealDrawer('desayuno')}
                  className="mt-1 flex items-center gap-space-xs px-space-md py-2 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg font-medium transition-all shadow-sm cursor-pointer"
                  type="button"
                >
                  <span className="material-symbols-outlined text-base">add_circle</span>
                  <span>+ Registrar primera comida de este día</span>
                </button>
              </div>
            ) : (
              /* Real Meals List - Each item rendered exactly once */
              dayMeals.map((meal: MealLogItem) => {
                const icon = MOMENT_ICONS[meal.moment] || 'restaurant';
                const momentName = MOMENT_LABELS[meal.moment] || meal.moment;
                const timeStr = formatTimeOnly(meal.dateTime);

                return (
                  <div
                    key={meal.id}
                    className="p-space-md bg-surface-container-low rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-sm border border-surface-container/40"
                  >
                    <div className="flex items-start gap-space-md">
                      <div className="w-12 h-12 rounded-lg bg-surface-container-lowest flex items-center justify-center text-primary shadow-xs shrink-0">
                        <span className="material-symbols-outlined text-2xl">{icon}</span>
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-space-xs flex-wrap">
                          <span className="font-headline-sm text-headline-sm text-on-surface font-semibold capitalize">
                            {momentName}
                          </span>
                          {timeStr && (
                            <span className="font-code-data text-code-data text-on-surface-variant">
                              {timeStr}
                            </span>
                          )}
                          {meal.verified && (
                            <span className="text-[11px] font-medium bg-primary/10 text-primary px-1.5 py-0.2 rounded font-code-data">
                              Pesaje verificado
                            </span>
                          )}
                        </div>
                        <span className="font-body-md text-body-md font-medium text-on-surface mt-0.5">
                          {meal.title}
                        </span>
                        {meal.description && (
                          <p className="font-body-md text-xs text-on-surface-variant mt-0.5 line-clamp-1">
                            {meal.description}
                          </p>
                        )}
                        <div className="flex items-center gap-space-md mt-space-xs font-code-data text-code-data text-on-surface-variant text-xs">
                          <span>
                            P: <strong className="text-on-surface">{meal.protein}g</strong>
                          </span>
                          <span>
                            C: <strong className="text-on-surface">{meal.carbs}g</strong>
                          </span>
                          <span>
                            G: <strong className="text-on-surface">{meal.fats}g</strong>
                          </span>
                          <span className="text-primary font-bold">{meal.calories} kcal</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate('registro-de-comidas')}
                      className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface self-end sm:self-center transition-colors cursor-pointer"
                      type="button"
                      title="Ver y editar en Registro de Comidas"
                    >
                      <span className="material-symbols-outlined text-base">edit</span>
                    </button>
                  </div>
                );
              })
            )}

            {/* Pending Standard Moments (e.g. if dinner is not yet recorded for this day) */}
            {dayMeals.length > 0 &&
              STANDARD_MOMENTS.filter(m => !recordedMomentsSet.has(m)).map(momentKey => {
                const icon = MOMENT_ICONS[momentKey];
                const momentName = MOMENT_LABELS[momentKey];

                return (
                  <div
                    key={`pending-${momentKey}`}
                    className="p-space-md bg-surface-container-lowest border-2 border-dashed border-outline-variant/50 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-sm"
                  >
                    <div className="flex items-start gap-space-md">
                      <div className="w-12 h-12 rounded-lg bg-surface-container-low flex items-center justify-center text-on-surface-variant shrink-0">
                        <span className="material-symbols-outlined text-2xl">{icon}</span>
                      </div>
                      <div className="flex flex-col">
                        <div className="flex items-center gap-space-xs">
                          <span className="font-headline-sm text-headline-sm text-on-surface font-medium capitalize">
                            {momentName} (Pendiente)
                          </span>
                          <span className="font-label-sm text-label-sm bg-surface-container text-on-surface-variant px-1.5 py-0.5 rounded font-medium text-xs">
                            Sin registro aún
                          </span>
                        </div>
                        <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
                          Aún no has registrado alimentos para el {momentName.toLowerCase()} de esta fecha.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => openMealDrawer(momentKey)}
                      className="flex items-center gap-space-xs px-space-md py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md rounded-lg font-medium transition-colors shrink-0 self-end sm:self-center cursor-pointer shadow-xs"
                      type="button"
                    >
                      <span className="material-symbols-outlined text-base text-primary">add</span>
                      <span>Registrar {momentName.toLowerCase()}</span>
                    </button>
                  </div>
                );
              })}
          </div>
        </div>

        {/* Right Column (1/3): Quick Access Cards */}
        <div className="flex flex-col gap-space-md">
          {/* Card: Menú Semanal Planificado */}
          <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col gap-space-xs">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
                Menú Semanal Planificado
              </span>
              <span className="material-symbols-outlined text-primary text-base">restaurant_menu</span>
            </div>
            <div className="mt-space-xs">
              <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                Planificación Nutricional
              </span>
              <p className="font-body-md text-body-md text-on-surface-variant mt-0.5 text-xs">
                Consulta los platos programados, macros distribuidos y recetas sincronizadas para la semana.
              </p>
            </div>
            <div className="pt-space-xs flex items-center justify-between">
              <span className="font-code-data text-code-data text-primary font-medium text-xs">Hoja: Menu_Semanal</span>
              <button
                onClick={() => navigate('menu-semanal')}
                className="font-label-md text-label-md text-primary font-semibold flex items-center gap-1 hover:underline cursor-pointer text-xs"
              >
                <span>Ver menú completo</span>
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </button>
            </div>
          </div>

          {/* Card: Lista de Compras */}
          <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col gap-space-xs">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
                Lista de Compras
              </span>
              <span className="material-symbols-outlined text-secondary text-base">shopping_cart</span>
            </div>
            <div className="mt-space-xs flex items-center gap-space-sm">
              <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container shrink-0 font-headline-sm text-headline-sm font-bold">
                {pendingGroceriesCount}
              </div>
              <div className="flex flex-col">
                <span className="font-label-md text-label-md text-on-surface font-semibold">
                  Artículos pendientes en la despensa
                </span>
                <span className="font-body-md text-body-md text-on-surface-variant text-xs">
                  {pendingGroceriesCount > 0 ? 'Insumos necesarios para tus recetas' : 'Despensa al día'}
                </span>
              </div>
            </div>
            <div className="pt-space-xs">
              <button
                onClick={() => navigate('lista-de-compras')}
                className="w-full flex items-center justify-center gap-space-xs py-2 bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md rounded-lg font-medium transition-colors cursor-pointer text-xs"
                type="button"
              >
                <span className="material-symbols-outlined text-base">checklist</span>
                <span>Abrir lista de compras</span>
              </button>
            </div>
          </div>

          {/* Card: Estado del Registro Diario */}
          <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col gap-space-sm">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
                Progreso del Registro
              </span>
              <span className="font-code-data text-code-data text-on-surface font-semibold text-xs">
                {selectedDate}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between font-label-md text-label-md">
                <span className="text-on-surface font-medium text-xs">Tomas registradas</span>
                <span className="text-primary font-semibold text-xs">{recordedMomentsSet.size}/4 comidas</span>
              </div>
              <div className="w-full bg-surface-container-high rounded-full h-2 overflow-hidden">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, (recordedMomentsSet.size / 4) * 100)}%` }}
                />
              </div>
            </div>
            <div className="p-2.5 rounded-lg bg-surface-container-low flex items-start gap-space-xs">
              <span className="material-symbols-outlined text-sm text-primary mt-0.5">verified</span>
              <p className="font-label-sm text-label-sm text-on-surface-variant text-xs">
                Integridad de base de datos activa: las tomas vacías se conservan como 'no registradas' sin generar sesgo a cero en tus promedios semanales.
              </p>
            </div>
            <button
              onClick={() => navigate('registro-diario')}
              className="text-left font-label-md text-label-md text-primary font-semibold hover:underline flex items-center gap-1 pt-1 text-xs cursor-pointer"
            >
              <span>Ver cronología completa en Registro Diario</span>
              <span className="material-symbols-outlined text-sm">arrow_forward</span>
            </button>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* MODAL: CONFIRMACIÓN EXPLÍCITA DE PERIODIZACIÓN NUTRICIONAL */}
      {/* ======================================================== */}
      {isPeriodizationConfirmModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest max-w-lg w-full rounded-2xl p-6 shadow-xl border border-surface-container flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">tune</span>
                </div>
                <div>
                  <h3 className="font-headline-sm text-base font-bold text-on-surface">
                    Confirmar Periodización Nutricional
                  </h3>
                  <p className="text-xs text-on-surface-variant">
                    Actualización asistida de metas metabólicas
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsPeriodizationConfirmModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="text-xs text-on-surface-variant flex flex-col gap-2">
              <p>
                Estás a punto de actualizar tus metas nutricionales oficiales para sincronizarlas con la fase:{' '}
                <strong className="text-on-surface">{periodizationRecommendation.mesocyclePhase}</strong>.
              </p>
              {periodizationRecommendation.rationale.map((r, i) => (
                <div key={i} className="flex items-start gap-1.5 p-2 rounded bg-surface-container-low text-[11px]">
                  <span className="material-symbols-outlined text-primary text-sm shrink-0">check_circle</span>
                  <span>{r}</span>
                </div>
              ))}
            </div>

            {/* Changes table */}
            <div className="rounded-xl border border-surface-container overflow-hidden text-xs">
              <div className="grid grid-cols-3 bg-surface-container p-2 font-semibold text-on-surface text-[11px]">
                <span>Parámetro</span>
                <span>Actual</span>
                <span className="text-primary font-bold">Propuesta Periodizada</span>
              </div>
              <div className="grid grid-cols-3 p-2 border-t border-surface-container/60">
                <span>Calorías</span>
                <span>{periodizationRecommendation.currentPlan.targetCalories} kcal</span>
                <span className="font-bold text-primary font-mono">{periodizationRecommendation.proposedPlan.targetCalories} kcal</span>
              </div>
              <div className="grid grid-cols-3 p-2 border-t border-surface-container/60">
                <span>Proteínas</span>
                <span>{periodizationRecommendation.currentPlan.targetProteinG} g ({periodizationRecommendation.currentPlan.proteinPerKg}g/kg)</span>
                <span className="font-bold text-primary font-mono">{periodizationRecommendation.proposedPlan.targetProteinG} g ({periodizationRecommendation.proposedPlan.proteinPerKg}g/kg)</span>
              </div>
              <div className="grid grid-cols-3 p-2 border-t border-surface-container/60">
                <span>Carbohidratos</span>
                <span>{periodizationRecommendation.currentPlan.targetCarbsG} g</span>
                <span className="font-bold text-secondary font-mono">{periodizationRecommendation.proposedPlan.targetCarbsG} g</span>
              </div>
              <div className="grid grid-cols-3 p-2 border-t border-surface-container/60">
                <span>Grasas</span>
                <span>{periodizationRecommendation.currentPlan.targetFatG} g ({periodizationRecommendation.currentPlan.fatPerKg}g/kg)</span>
                <span className="font-bold text-tertiary font-mono">{periodizationRecommendation.proposedPlan.targetFatG} g ({periodizationRecommendation.proposedPlan.fatPerKg}g/kg)</span>
              </div>
            </div>

            <p className="text-[11px] text-on-surface-variant italic">
              Nota de seguridad: Esta acción recalcula tus requerimientos en base de datos. Tus comidas ya registradas no se modificarán.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsPeriodizationConfirmModalOpen(false)}
                disabled={isApplyingPeriodization}
                className="px-4 py-2 rounded-lg text-xs font-medium text-on-surface-variant hover:bg-surface-container cursor-pointer transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleApplyPeriodization}
                disabled={isApplyingPeriodization}
                className="px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-on-primary text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
              >
                {isApplyingPeriodization ? (
                  <>
                    <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                    <span>Actualizando...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">done_all</span>
                    <span>Confirmar y Actualizar Metas</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL: REVERTIR A METAS NUTRICIONALES ANTERIORES         */}
      {/* ======================================================== */}
      {isRevertConfirmModalOpen && biometrics.lastAppliedPeriodization?.previousTargets && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-surface-container-lowest max-w-lg w-full rounded-2xl p-6 shadow-xl border border-surface-container flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-tertiary/10 text-tertiary flex items-center justify-center">
                  <span className="material-symbols-outlined text-xl">history</span>
                </div>
                <div>
                  <h3 className="font-headline-sm text-base font-bold text-on-surface">
                    Revertir a Metas Anteriores
                  </h3>
                  <p className="text-xs text-on-surface-variant">
                    Restaurar valores previos a la última periodización
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsRevertConfirmModalOpen(false)}
                className="text-on-surface-variant hover:text-on-surface cursor-pointer"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="text-xs text-on-surface-variant flex flex-col gap-2">
              <p>
                Vas a restaurar las metas nutricionales activas antes de la aplicación de la fase:{' '}
                <strong className="text-on-surface">{biometrics.lastAppliedPeriodization.phase}</strong> ({new Date(biometrics.lastAppliedPeriodization.appliedAt).toLocaleDateString()}).
              </p>
              <div className="p-2 rounded bg-tertiary/10 border border-tertiary/30 text-on-surface-variant text-[11px] flex items-start gap-1.5">
                <span className="material-symbols-outlined text-xs text-tertiary mt-0.5">info</span>
                <span><strong>Alcance de reversión:</strong> Esta operación restablece la configuración inmediatamente anterior (1 nivel de deshacer). Una vez ejecutada, el registro previo queda liberado.</span>
              </div>
            </div>

            {/* Target comparison table */}
            <div className="rounded-xl border border-surface-container overflow-hidden text-xs">
              <div className="grid grid-cols-3 bg-surface-container p-2 font-semibold text-on-surface text-[11px]">
                <span>Parámetro</span>
                <span>Meta Activa</span>
                <span className="text-tertiary font-bold">Meta a Restaurar</span>
              </div>
              <div className="grid grid-cols-3 p-2 border-t border-surface-container/60">
                <span>Calorías</span>
                <span>{biometrics.targetCalories} kcal</span>
                <span className="font-bold text-tertiary font-mono">{biometrics.lastAppliedPeriodization.previousTargets.targetCalories} kcal</span>
              </div>
              <div className="grid grid-cols-3 p-2 border-t border-surface-container/60">
                <span>Proteínas</span>
                <span>{biometrics.targetProteinG} g</span>
                <span className="font-bold text-tertiary font-mono">{biometrics.lastAppliedPeriodization.previousTargets.targetProteinG} g ({biometrics.lastAppliedPeriodization.previousTargets.proteinPerKg}g/kg)</span>
              </div>
              <div className="grid grid-cols-3 p-2 border-t border-surface-container/60">
                <span>Carbohidratos</span>
                <span>{biometrics.targetCarbsG} g</span>
                <span className="font-bold text-tertiary font-mono">{biometrics.lastAppliedPeriodization.previousTargets.targetCarbsG} g</span>
              </div>
              <div className="grid grid-cols-3 p-2 border-t border-surface-container/60">
                <span>Grasas</span>
                <span>{biometrics.targetFatG} g</span>
                <span className="font-bold text-tertiary font-mono">{biometrics.lastAppliedPeriodization.previousTargets.targetFatG} g ({biometrics.lastAppliedPeriodization.previousTargets.fatPerKg}g/kg)</span>
              </div>
            </div>

            <p className="text-[11px] text-on-surface-variant italic">
              Tus comidas ya registradas y el menú semanal no se alteran al revertir.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsRevertConfirmModalOpen(false)}
                disabled={isRevertingPeriodization}
                className="px-4 py-2 rounded-lg text-xs font-medium text-on-surface-variant hover:bg-surface-container cursor-pointer transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleRevertPeriodization}
                disabled={isRevertingPeriodization}
                className="px-4 py-2 rounded-lg bg-tertiary hover:bg-tertiary/90 text-on-tertiary text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
              >
                {isRevertingPeriodization ? (
                  <>
                    <span className="material-symbols-outlined text-sm animate-spin">progress_activity</span>
                    <span>Revirtiendo...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">history</span>
                    <span>Confirmar Reversión</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
