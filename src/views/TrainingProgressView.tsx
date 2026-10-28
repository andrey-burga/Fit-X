import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { ExportWorkoutModal } from '../components/modals/ExportWorkoutModal';
import {
  computeConsolidatedAnalytics,
  AnalyticsFilterOptions,
  AnalyticsPeriodOption,
  PRIMARY_COMPOUND_LIFTS,
  ExerciseProgressionSummary,
} from '../services/workoutAnalyticsService';
import { MuscleGroup } from '../types/workout';
import { getLocalDateString } from '../services/dateUtils';

export const TrainingProgressView: React.FC = () => {
  const { showToast, workoutHistory, executedWorkoutsHistory, currentUser } = useApp();

  // Filters State
  const [selectedPeriod, setSelectedPeriod] = useState<AnalyticsPeriodOption>('12w');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup | 'all'>('all');
  const [activeLiftFilter, setActiveLiftFilter] = useState<string>('all');
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'visual' | 'table'>('visual');
  const [selectedWeeklyHover, setSelectedWeeklyHover] = useState<number | null>(null);

  // Filter options consolidated
  const filterOptions: AnalyticsFilterOptions = useMemo(() => ({
    period: selectedPeriod,
    customStartDate: customStartDate || undefined,
    customEndDate: customEndDate || undefined,
    muscleGroup: selectedMuscle,
    exerciseId: activeLiftFilter !== 'all' ? activeLiftFilter : undefined,
  }), [selectedPeriod, customStartDate, customEndDate, selectedMuscle, activeLiftFilter]);

  // Compute Master Analytics
  const analytics = useMemo(() => {
    return computeConsolidatedAnalytics(
      executedWorkoutsHistory,
      workoutHistory,
      filterOptions
    );
  }, [executedWorkoutsHistory, workoutHistory, filterOptions]);

  const {
    totalEffectiveTonnageKg,
    completedSessionsCount,
    abandonedSessionsCount,
    totalEffectiveSets,
    totalWarmupSets,
    totalReps,
    averageDurationMinutes,
    weeklyBuckets,
    acwr,
    exerciseProgressions,
    recoveryIndicators,
    primaryLifts,
    periodComparison,
  } = analytics;

  // Current primary lift selected for detailed progression chart
  const selectedLiftSummary: ExerciseProgressionSummary | undefined = useMemo(() => {
    if (activeLiftFilter === 'all') {
      return primaryLifts[0]?.summary;
    }
    const match = primaryLifts.find(l => l.id === activeLiftFilter || l.canonicalId === activeLiftFilter);
    if (match?.summary) return match.summary;
    return exerciseProgressions[activeLiftFilter];
  }, [activeLiftFilter, primaryLifts, exerciseProgressions]);

  // Max weekly tonnage for SVG scaling
  const maxWeeklyTonnage = useMemo(() => {
    const maxVal = Math.max(...weeklyBuckets.map(b => b.effectiveTonnageKg), 0);
    return maxVal > 0 ? maxVal : 10000;
  }, [weeklyBuckets]);

  // Max weekly sessions for line chart scaling
  const maxWeeklySessions = useMemo(() => {
    const maxVal = Math.max(...weeklyBuckets.map(b => b.completedSessions), 0);
    return Math.max(maxVal, 5);
  }, [weeklyBuckets]);

  // Period label helper
  const periodDisplayLabel = useMemo(() => {
    switch (selectedPeriod) {
      case '4w': return 'Últimas 4 Semanas (28 días)';
      case '12w': return 'Últimas 12 Semanas (84 días)';
      case '24w': return 'Últimos 6 Meses (180 días)';
      case 'all': return 'Todo el Historial Registrado';
      case 'custom': return 'Rango Personalizado';
      default: return 'Período Activo';
    }
  }, [selectedPeriod]);

  return (
    <div className="p-4 sm:p-gutter-desktop max-w-[1440px] mx-auto w-full flex flex-col gap-space-xl animate-in fade-in duration-150">
      {/* 1. Header Bar with Rich Controls */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-space-lg">
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-xs flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-space-sm py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-label-sm text-label-sm uppercase tracking-wider font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {periodDisplayLabel}
            </span>
            {periodComparison && periodComparison.previousTonnage > 0 && (
              <span className="inline-flex items-center gap-1 px-space-sm py-0.5 rounded-full bg-surface-container-high text-primary font-label-sm text-label-sm font-semibold">
                <span className="material-symbols-outlined text-sm">
                  {periodComparison.tonnageDeltaKg >= 0 ? 'trending_up' : 'trending_down'}
                </span>
                Delta Tonelaje: {periodComparison.tonnageDeltaPct >= 0 ? `+${periodComparison.tonnageDeltaPct}%` : `${periodComparison.tonnageDeltaPct}%`} vs Período Previo
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-space-sm py-0.5 rounded-full bg-surface-container-low text-on-surface-variant font-label-sm text-label-sm">
              <span className="material-symbols-outlined text-xs">verified</span>
              Warmup Excluido del Tonelaje
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface font-semibold tracking-tight">
            Progreso y Analítica del Entrenamiento
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-3xl">
            Sobrecarga progresiva real, progresión de 1RM estimado (fórmula de Epley), carga aguda y crónica (ACWR) y monitoreo indirecto de recuperación.
          </p>
        </div>

        {/* Global Controls & Export Trigger */}
        <div className="flex items-center gap-space-sm flex-wrap shrink-0">
          {/* Period Selector */}
          <div className="relative">
            <select
              value={selectedPeriod}
              onChange={e => {
                const val = e.target.value as AnalyticsPeriodOption;
                setSelectedPeriod(val);
                showToast(`Analizando período: ${e.target.options[e.target.selectedIndex].text}`);
              }}
              className="appearance-none bg-surface-container-lowest text-on-surface font-label-md text-label-md py-2 pl-space-md pr-8 rounded-lg shadow-xs focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer border border-surface-container/60"
            >
              <option value="4w">Últimas 4 Semanas</option>
              <option value="12w">Últimas 12 Semanas</option>
              <option value="24w">Últimos 6 Meses</option>
              <option value="all">Todo el Historial</option>
              <option value="custom">Personalizado...</option>
            </select>
            <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-on-surface-variant pointer-events-none">
              expand_more
            </span>
          </div>

          {/* Muscle Group Filter */}
          <div className="relative">
            <select
              value={selectedMuscle}
              onChange={e => setSelectedMuscle(e.target.value as any)}
              className="appearance-none bg-surface-container-lowest text-on-surface font-label-md text-label-md py-2 pl-space-md pr-8 rounded-lg shadow-xs focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer border border-surface-container/60"
            >
              <option value="all">Todos los Músculos</option>
              <option value="pecho">Pecho</option>
              <option value="espalda">Espalda</option>
              <option value="hombros">Hombros</option>
              <option value="cuadriceps">Cuádriceps</option>
              <option value="isquios">Isquios / Posterior</option>
              <option value="gluteos">Glúteos</option>
              <option value="biceps">Bíceps</option>
              <option value="triceps">Tríceps</option>
              <option value="core">Core</option>
            </select>
            <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-on-surface-variant pointer-events-none">
              filter_list
            </span>
          </div>

          {/* Export CSV / PDF Modal Trigger (Increment 6E) */}
          <button
            onClick={() => setIsExportModalOpen(true)}
            className="flex items-center gap-space-xs px-space-md py-2 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg shadow-xs transition-colors cursor-pointer font-medium"
            type="button"
          >
            <span className="material-symbols-outlined text-base">file_download</span>
            <span>Exportar CSV / PDF</span>
          </button>
        </div>
      </div>

      {/* Custom Date Pickers (if 'custom' selected) */}
      {selectedPeriod === 'custom' && (
        <div className="bg-surface-container-lowest p-space-md rounded-xl border border-surface-container/60 flex items-center gap-space-md flex-wrap">
          <span className="font-label-sm text-label-sm font-semibold text-on-surface">Rango Específico:</span>
          <div className="flex items-center gap-2">
            <label className="font-label-sm text-label-sm text-on-surface-variant">Desde:</label>
            <input
              type="date"
              value={customStartDate}
              onChange={e => setCustomStartDate(e.target.value)}
              className="bg-surface-container-low text-on-surface px-2 py-1 rounded border border-surface-container font-code-data text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="font-label-sm text-label-sm text-on-surface-variant">Hasta:</label>
            <input
              type="date"
              value={customEndDate}
              onChange={e => setCustomEndDate(e.target.value)}
              className="bg-surface-container-low text-on-surface px-2 py-1 rounded border border-surface-container font-code-data text-sm"
            />
          </div>
        </div>
      )}

      {/* 2. Top Executive KPI Cards (Real Data Derived) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
        {/* KPI 1: Tonelaje Efectivo */}
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="font-label-sm text-label-sm uppercase tracking-wider font-semibold">
              Tonelaje Efectivo
            </span>
            <span className="material-symbols-outlined text-base text-primary">fitness_center</span>
          </div>
          <div>
            <div className="flex items-baseline gap-1">
              <span className="font-metric-xl text-metric-xl text-on-surface font-bold">
                {totalEffectiveTonnageKg.toLocaleString()}
              </span>
              <span className="font-label-md text-label-md text-on-surface-variant">kg</span>
            </div>
            <div className="flex items-center gap-1.5 mt-space-xs text-primary font-label-sm text-label-sm">
              {periodComparison ? (
                <>
                  <span className="material-symbols-outlined text-sm">
                    {periodComparison.tonnageDeltaKg >= 0 ? 'arrow_upward' : 'arrow_downward'}
                  </span>
                  <span className="font-semibold">
                    {periodComparison.tonnageDeltaKg >= 0 ? `+${periodComparison.tonnageDeltaKg.toLocaleString()} kg` : `${periodComparison.tonnageDeltaKg.toLocaleString()} kg`}
                  </span>
                  <span className="text-on-surface-variant font-normal">vs período anterior</span>
                </>
              ) : (
                <span className="text-on-surface-variant font-normal">Total en período seleccionado</span>
              )}
            </div>
          </div>
          <div className="text-xs text-on-surface-variant flex items-center justify-between pt-1 border-t border-surface-container/30">
            <span>Series efectivas: <strong>{totalEffectiveSets}</strong></span>
            <span>Calentamiento: <strong>{totalWarmupSets} excluidas</strong></span>
          </div>
        </div>

        {/* KPI 2: Sesiones Completadas vs Abandonadas */}
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="font-label-sm text-label-sm uppercase tracking-wider font-semibold">
              Sesiones & Adherencia
            </span>
            <span className="material-symbols-outlined text-base text-primary">event_available</span>
          </div>
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-metric-xl text-metric-xl text-on-surface font-bold">
                {completedSessionsCount}
              </span>
              <span className="font-label-md text-label-md text-on-surface-variant">completadas</span>
              {abandonedSessionsCount > 0 && (
                <span className="text-amber-700 font-label-sm text-label-sm font-medium">
                  ({abandonedSessionsCount} canceladas)
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-space-xs text-on-surface-variant font-label-sm text-label-sm">
              <span className="material-symbols-outlined text-sm text-primary">timer</span>
              <span>Promedio: <strong>{averageDurationMinutes} min</strong> por sesión</span>
            </div>
          </div>
          <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-primary h-full rounded-full transition-all"
              style={{
                width: `${completedSessionsCount + abandonedSessionsCount > 0 ? (completedSessionsCount / (completedSessionsCount + abandonedSessionsCount)) * 100 : 0}%`,
              }}
            />
          </div>
        </div>

        {/* KPI 3: Proximidad al Fallo (RIR Medio) */}
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="font-label-sm text-label-sm uppercase tracking-wider font-semibold">
              Intensidad & Esfuerzo (RIR)
            </span>
            <span className="material-symbols-outlined text-base text-primary">tune</span>
          </div>
          <div>
            <div className="flex items-baseline gap-1">
              <span className="font-metric-xl text-metric-xl text-on-surface font-bold">
                {recoveryIndicators.averageEffectiveRir !== null ? recoveryIndicators.averageEffectiveRir : '—'}
              </span>
              <span className="font-label-md text-label-md text-on-surface-variant">RIR medio</span>
            </div>
            <div className="flex items-center gap-1.5 mt-space-xs font-label-sm text-label-sm text-on-surface-variant">
              <span className="font-semibold text-primary">{recoveryIndicators.highIntensityPercentage}%</span>
              <span>de series con RIR ≤ 2 (estímulo hipertrófico)</span>
            </div>
          </div>
          <div className="text-xs text-on-surface-variant flex items-center justify-between pt-1 border-t border-surface-container/30">
            <span>Reps totales: <strong>{totalReps}</strong></span>
            <span>Densidad: <strong>{recoveryIndicators.sessionDensityKgPerMin ? `${recoveryIndicators.sessionDensityKgPerMin} kg/min` : 'N/D'}</strong></span>
          </div>
        </div>

        {/* KPI 4: Ratio de Carga ACWR */}
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="font-label-sm text-label-sm uppercase tracking-wider font-semibold">
              Ratio ACWR (Carga Externa)
            </span>
            <span className="material-symbols-outlined text-base text-primary">speed</span>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="font-metric-xl text-metric-xl text-on-surface font-bold">
                {acwr.isCalculable && acwr.acwrTonnageRatio !== null ? acwr.acwrTonnageRatio : 'N/D'}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${acwr.statusBadgeColor}`}>
                {acwr.statusLabel}
              </span>
            </div>
            <div className="mt-space-xs font-label-sm text-label-sm text-on-surface-variant">
              {acwr.isCalculable ? (
                <span>Aguda 7d: <strong>{acwr.acuteTonnageKg.toLocaleString()} kg</strong> vs Crónica sem: <strong>{acwr.chronicWeeklyBaselineTonnageKg.toLocaleString()} kg</strong></span>
              ) : (
                <span className="text-xs text-on-surface-variant">{acwr.insufficiencyReason || 'Historial insuficiente (<35 días)'}</span>
              )}
            </div>
          </div>
          <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                acwr.status === 'high_spike'
                  ? 'bg-amber-500'
                  : acwr.status === 'optimal_progression'
                  ? 'bg-primary'
                  : 'bg-secondary'
              }`}
              style={{
                width: `${acwr.isCalculable && acwr.acwrTonnageRatio !== null ? Math.min(100, (acwr.acwrTonnageRatio / 2.0) * 100) : 10}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* 3. Deep Dive: Panel ACWR y Monitoreo Indirecto de Carga */}
      <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-sm pb-space-sm border-b border-surface-container/30">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-primary text-xl">monitor_heart</span>
              <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
                Monitoreo de Carga Aguda y Crónica (ACWR) e Indicadores Indirectos
              </h2>
            </div>
            <p className="font-body-md text-body-md text-on-surface-variant text-sm">
              Metodología normalizada: Carga aguda (últimos 7 días) dividida por la línea base semanal de las 4 semanas previas (28 días). Ventana total de 35 días.
            </p>
          </div>
          <span className="px-2.5 py-1 rounded bg-surface-container-low text-on-surface-variant font-code-data text-xs border border-surface-container/40">
            Carga de Volumen Externo
          </span>
        </div>

        {/* ACWR Status Alert & Heuristic Gauge */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-md items-center">
          <div className="lg:col-span-8 flex flex-col gap-space-sm">
            <div className={`p-space-md rounded-xl border flex items-start gap-space-sm ${
              acwr.status === 'optimal_progression'
                ? 'bg-primary-fixed/30 border-primary/20 text-on-surface'
                : acwr.status === 'elevated_load'
                ? 'bg-amber-50 border-amber-200 text-amber-950'
                : acwr.status === 'high_spike'
                ? 'bg-amber-100 border-amber-300 text-amber-950'
                : 'bg-surface-container-low border-surface-container text-on-surface'
            }`}>
              <span className="material-symbols-outlined text-xl text-primary shrink-0 mt-0.5">
                {acwr.status === 'optimal_progression' ? 'check_circle' : acwr.status === 'insufficient_data' ? 'info' : 'warning'}
              </span>
              <div className="flex flex-col gap-1">
                <span className="font-label-md text-label-md font-bold">
                  {acwr.statusLabel}
                </span>
                <p className="font-body-md text-body-md text-sm">
                  {acwr.feedbackMessage}
                </p>
                <span className="text-xs text-on-surface-variant/90 italic">
                  {acwr.methodologyNote}
                </span>
              </div>
            </div>

            {/* Heuristic Scale Visual Bar */}
            <div className="bg-surface-container-low p-space-md rounded-xl border border-surface-container/40 flex flex-col gap-space-xs">
              <div className="flex justify-between items-center text-xs font-semibold text-on-surface-variant">
                <span>Descarga (&lt;0.8)</span>
                <span className="text-primary font-bold">Sweet-Spot Heurístico (0.8 - 1.3)</span>
                <span>Incremento (1.3 - 1.5)</span>
                <span className="text-amber-800">Pico (&gt;1.5)</span>
              </div>
              <div className="relative w-full h-4 bg-surface-container rounded-full overflow-hidden flex">
                <div className="w-[40%] bg-secondary-fixed/50" title="Zona reducida / deload" />
                <div className="w-[25%] bg-primary/70" title="Zona de sweet spot" />
                <div className="w-[10%] bg-amber-200" title="Zona de incremento moderado" />
                <div className="w-[25%] bg-amber-400" title="Pico de carga aguda" />
              </div>
              {acwr.isCalculable && acwr.acwrTonnageRatio !== null && (
                <div className="text-right text-xs font-code-data text-on-surface font-semibold">
                  Tu Ratio Actual: <strong>{acwr.acwrTonnageRatio}</strong>
                </div>
              )}
            </div>
          </div>

          {/* Windows breakdown Card */}
          <div className="lg:col-span-4 bg-surface-container-low p-space-md rounded-xl border border-surface-container/40 flex flex-col gap-space-xs">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface font-bold">
              Desglose de Ventanas
            </span>
            <div className="flex justify-between items-center py-1 border-b border-surface-container/30 text-xs">
              <span className="text-on-surface-variant">Ventana Aguda (7d):</span>
              <span className="font-code-data font-bold text-on-surface">{acwr.acuteTonnageKg.toLocaleString()} kg</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-surface-container/30 text-xs">
              <span className="text-on-surface-variant">Sesiones Agudas:</span>
              <span className="font-code-data font-semibold text-on-surface">{acwr.acuteSessionsCount} sesiones</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-surface-container/30 text-xs">
              <span className="text-on-surface-variant">Línea Base Crónica (28d):</span>
              <span className="font-code-data font-bold text-on-surface">{acwr.chronicTotalTonnageKg.toLocaleString()} kg total</span>
            </div>
            <div className="flex justify-between items-center py-1 border-b border-surface-container/30 text-xs">
              <span className="text-on-surface-variant">Media Semanal Crónica:</span>
              <span className="font-code-data font-bold text-primary">{acwr.chronicWeeklyBaselineTonnageKg.toLocaleString()} kg/sem</span>
            </div>
            <div className="flex justify-between items-center py-1 text-xs">
              <span className="text-on-surface-variant">Historial Disponible:</span>
              <span className="font-code-data font-semibold text-on-surface">{acwr.availableHistoryDays} días registrados</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Evolución Semanal de Volumen & Frecuencia */}
      <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pb-space-sm border-b border-surface-container/30">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-primary text-xl">bar_chart</span>
              <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
                Evolución Semanal de Volumen (Tonelaje Efectivo) y Frecuencia
              </h2>
            </div>
            <p className="font-body-md text-body-md text-on-surface-variant text-sm">
              Distribución de kilogramos efectivos levantados por semana y número de sesiones completadas.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('visual')}
              className={`px-3 py-1.5 rounded-lg font-label-sm text-xs font-semibold transition-all ${
                activeTab === 'visual'
                  ? 'bg-primary text-on-primary shadow-xs'
                  : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Gráfico Visual
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('table')}
              className={`px-3 py-1.5 rounded-lg font-label-sm text-xs font-semibold transition-all ${
                activeTab === 'table'
                  ? 'bg-primary text-on-primary shadow-xs'
                  : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Tabla de Datos
            </button>
          </div>
        </div>

        {activeTab === 'visual' ? (
          <div className="bg-surface-container-low p-space-lg rounded-xl flex flex-col gap-space-md border border-surface-container/40">
            {/* Chart Legend */}
            <div className="flex items-center justify-between flex-wrap gap-space-sm text-xs">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5 font-semibold text-on-surface">
                  <span className="h-3 w-3 bg-primary rounded-xs inline-block" />
                  Tonelaje Efectivo Semanal (kg)
                </span>
                <span className="flex items-center gap-1.5 font-semibold text-on-surface">
                  <span className="h-2 w-2 rounded-full bg-tertiary inline-block" />
                  Sesiones Completadas
                </span>
              </div>
              <span className="text-on-surface-variant font-code-data">
                {weeklyBuckets.length} semanas analizadas
              </span>
            </div>

            {/* SVG Interactive Chart */}
            <div className="w-full h-64 relative">
              <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 800 200">
                {/* Horizontal reference grid */}
                <line stroke="#bccac0" strokeDasharray="3 3" strokeOpacity="0.3" x1="0" x2="800" y1="20" y2="20" />
                <line stroke="#bccac0" strokeDasharray="3 3" strokeOpacity="0.3" x1="0" x2="800" y1="70" y2="70" />
                <line stroke="#bccac0" strokeDasharray="3 3" strokeOpacity="0.3" x1="0" x2="800" y1="120" y2="120" />
                <line stroke="#bccac0" strokeDasharray="3 3" strokeOpacity="0.3" x1="0" x2="800" y1="170" y2="170" />

                {/* Bars for Weekly Tonnage */}
                {weeklyBuckets.map((b, idx) => {
                  const numB = weeklyBuckets.length;
                  const step = 800 / Math.max(numB, 1);
                  const barWidth = Math.max(12, Math.min(36, step * 0.55));
                  const x = idx * step + (step - barWidth) / 2;
                  const height = maxWeeklyTonnage > 0 ? (b.effectiveTonnageKg / maxWeeklyTonnage) * 150 : 0;
                  const y = 175 - height;

                  return (
                    <g key={b.weekStart} className="cursor-pointer" onClick={() => setSelectedWeeklyHover(idx)}>
                      <rect
                        x={x}
                        y={y}
                        width={barWidth}
                        height={height}
                        rx="3"
                        className={`transition-all ${
                          selectedWeeklyHover === idx
                            ? 'fill-primary stroke-2 stroke-primary-fixed'
                            : 'fill-primary/80 hover:fill-primary'
                        }`}
                      />
                    </g>
                  );
                })}

                {/* Polyline for Sessions Count */}
                {weeklyBuckets.length > 1 && (
                  <path
                    d={weeklyBuckets.map((b, idx) => {
                      const numB = weeklyBuckets.length;
                      const step = 800 / Math.max(numB, 1);
                      const x = idx * step + step / 2;
                      const y = 175 - (b.completedSessions / maxWeeklySessions) * 140;
                      return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                    }).join(' ')}
                    fill="none"
                    stroke="#006194"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                )}

                {/* Circles for Sessions Count Points */}
                {weeklyBuckets.map((b, idx) => {
                  const numB = weeklyBuckets.length;
                  const step = 800 / Math.max(numB, 1);
                  const x = idx * step + step / 2;
                  const y = 175 - (b.completedSessions / maxWeeklySessions) * 140;

                  return (
                    <circle
                      key={`pt_${b.weekStart}`}
                      cx={x}
                      cy={y}
                      r="4"
                      className="fill-tertiary stroke-2 stroke-surface-container-lowest"
                    />
                  );
                })}
              </svg>

              {/* X-Axis Labels */}
              <div className="flex justify-between text-on-surface-variant font-code-data text-xs pt-2">
                {weeklyBuckets.map((b, idx) => (
                  <span
                    key={`lbl_${b.weekStart}`}
                    className={`truncate text-center ${
                      selectedWeeklyHover === idx ? 'text-primary font-bold' : ''
                    }`}
                    style={{ width: `${100 / weeklyBuckets.length}%` }}
                  >
                    Sem {b.weekIndex}
                  </span>
                ))}
              </div>
            </div>

            {/* Selected Week Hover Card Details */}
            {selectedWeeklyHover !== null && weeklyBuckets[selectedWeeklyHover] && (
              <div className="bg-surface-container-lowest p-space-sm rounded-lg border border-surface-container/60 flex items-center justify-between flex-wrap gap-space-sm animate-in fade-in duration-100">
                <div className="flex items-center gap-space-sm">
                  <span className="material-symbols-outlined text-primary text-base">calendar_view_week</span>
                  <span className="font-label-md text-label-md font-bold text-on-surface">
                    {weeklyBuckets[selectedWeeklyHover].label}
                  </span>
                </div>
                <div className="flex items-center gap-space-md text-xs font-code-data">
                  <span>Tonelaje: <strong className="text-primary">{weeklyBuckets[selectedWeeklyHover].effectiveTonnageKg.toLocaleString()} kg</strong></span>
                  <span>Sesiones: <strong>{weeklyBuckets[selectedWeeklyHover].completedSessions}</strong></span>
                  <span>Series: <strong>{weeklyBuckets[selectedWeeklyHover].effectiveSets}</strong></span>
                  <span>RIR: <strong>{weeklyBuckets[selectedWeeklyHover].averageRir ?? 'N/D'}</strong></span>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Accessible Data Table Alternative */
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm uppercase tracking-wider">
                  <th className="py-2.5 px-space-md rounded-l-lg">Semana</th>
                  <th className="py-2.5 px-space-md">Rango Fechas</th>
                  <th className="py-2.5 px-space-md text-right">Tonelaje Efectivo</th>
                  <th className="py-2.5 px-space-md text-right">Sesiones</th>
                  <th className="py-2.5 px-space-md text-right">Series Efectivas</th>
                  <th className="py-2.5 px-space-md text-right">Repeticiones</th>
                  <th className="py-2.5 px-space-md text-right">RIR Medio</th>
                  <th className="py-2.5 px-space-md rounded-r-lg text-right">Días Entrenados</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container font-body-md text-on-surface">
                {weeklyBuckets.map(b => (
                  <tr key={b.weekStart} className="hover:bg-surface-container-low transition-colors">
                    <td className="py-2 px-space-md font-bold">Sem {b.weekIndex}</td>
                    <td className="py-2 px-space-md font-code-data text-on-surface-variant">{b.weekStart} a {b.weekEnd}</td>
                    <td className="py-2 px-space-md text-right font-code-data font-bold text-primary">{b.effectiveTonnageKg.toLocaleString()} kg</td>
                    <td className="py-2 px-space-md text-right font-code-data">{b.completedSessions}</td>
                    <td className="py-2 px-space-md text-right font-code-data">{b.effectiveSets}</td>
                    <td className="py-2 px-space-md text-right font-code-data">{b.totalReps}</td>
                    <td className="py-2 px-space-md text-right font-code-data">{b.averageRir ?? '—'}</td>
                    <td className="py-2 px-space-md text-right font-code-data">{b.frequencyDays} d/sem</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. Progresión de Fuerza en Levantamientos Principales (1RM Estimado) */}
      <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md pb-space-sm border-b border-surface-container/30">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-primary text-xl">insights</span>
              <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
                Progresión de Fuerza y 1RM Estimado (Fórmula de Epley)
              </h2>
            </div>
            <p className="font-body-md text-body-md text-on-surface-variant text-sm">
              Estimación de 1RM = Carga × (1 + Reps / 30). Las marcas se basan exclusivamente en series efectivas completadas.
            </p>
          </div>

          {/* Exercise Selector Pills */}
          <div className="flex items-center gap-space-xs bg-surface-container-low p-1 rounded-lg self-start flex-wrap border border-surface-container/40">
            <button
              onClick={() => setActiveLiftFilter('all')}
              className={`px-space-sm py-1 rounded-md font-label-sm text-xs transition-all ${
                activeLiftFilter === 'all'
                  ? 'bg-surface-container-lowest text-on-surface shadow-xs font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
              type="button"
            >
              Todos los Básicos
            </button>
            {PRIMARY_COMPOUND_LIFTS.map(lift => (
              <button
                key={lift.id}
                onClick={() => setActiveLiftFilter(lift.id)}
                className={`px-space-sm py-1 rounded-md font-label-sm text-xs transition-all ${
                  activeLiftFilter === lift.id
                    ? 'bg-surface-container-lowest text-on-surface shadow-xs font-semibold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                type="button"
              >
                {lift.name.split(' ')[0]} {lift.name.split(' ')[1] || ''}
              </button>
            ))}
          </div>
        </div>

        {/* 5 Primary Lift Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-space-md">
          {primaryLifts.map(lift => {
            const summary = lift.summary;
            const hasData = summary && summary.historyPoints.length > 0;
            const best1RM = hasData ? summary.allTimeBest1RM : 0;
            const bestWeight = hasData ? summary.allTimeBestWeightKg : 0;
            const bestReps = hasData ? summary.allTimeBestReps : 0;
            const bestRir = hasData ? summary.allTimeBestRir : null;
            const changePct = summary?.net1RMChangePct !== undefined ? `${summary.net1RMChangePct >= 0 ? '+' : ''}${summary.net1RMChangePct}%` : '—';

            return (
              <div
                key={lift.id}
                onClick={() => setActiveLiftFilter(lift.id)}
                className={`p-space-md rounded-xl flex flex-col justify-between gap-space-md transition-all cursor-pointer border ${
                  activeLiftFilter === lift.id
                    ? 'bg-surface-container ring-1 ring-primary border-primary'
                    : 'bg-surface-container-low hover:bg-surface-container border-surface-container/40'
                }`}
              >
                <div className="flex justify-between items-start">
                  <div className="flex flex-col">
                    <span className="font-label-sm text-xs uppercase tracking-wider text-on-surface-variant font-semibold">
                      {lift.category.split('/')[0]}
                    </span>
                    <h3 className="font-headline-sm text-sm text-on-surface font-semibold line-clamp-1">
                      {lift.name}
                    </h3>
                  </div>
                  {hasData && (
                    <span className="px-1.5 py-0.5 rounded bg-surface-container-lowest text-primary font-code-data text-xs font-bold shadow-xs">
                      {changePct}
                    </span>
                  )}
                </div>

                <div className="flex items-baseline gap-1.5">
                  <span className="font-metric-xl text-xl text-on-surface font-bold">
                    {best1RM > 0 ? best1RM : '—'}
                  </span>
                  <span className="font-label-md text-xs text-on-surface-variant">kg 1RM</span>
                </div>

                {/* Mini Sparkline */}
                <div className="w-full h-8">
                  {hasData && summary.historyPoints.length > 1 ? (
                    <svg className="w-full h-full text-primary" fill="none" preserveAspectRatio="none" viewBox="0 0 100 24">
                      <path
                        d={summary.historyPoints.map((p, idx) => {
                          const x = (idx / (summary.historyPoints.length - 1)) * 100;
                          const min = Math.min(...summary.historyPoints.map(pt => pt.estimated1RM));
                          const max = Math.max(...summary.historyPoints.map(pt => pt.estimated1RM));
                          const range = max - min || 1;
                          const y = 20 - ((p.estimated1RM - min) / range) * 16;
                          return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                        }).join(' ')}
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-on-surface-variant/60 italic">
                      {hasData ? '1 registro' : 'Sin registros'}
                    </div>
                  )}
                </div>

                <div className="pt-1 bg-surface-container-lowest/60 p-2 rounded-lg flex flex-col gap-0.5 border border-surface-container/30 text-xs">
                  <span className="text-on-surface-variant font-medium">Mejor Serie:</span>
                  <span className="font-code-data text-on-surface font-semibold truncate">
                    {hasData ? `${bestWeight} kg × ${bestReps} reps ${bestRir !== null ? `@ RIR ${bestRir}` : ''}` : 'Pendiente de registrar'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Selected Lift Temporal Curve Detail */}
        {selectedLiftSummary && selectedLiftSummary.historyPoints.length > 0 && (
          <div className="bg-surface-container-low p-space-md rounded-xl flex flex-col gap-space-sm border border-surface-container/40">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="font-label-md text-sm font-semibold text-on-surface flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-primary" />
                Curva de 1RM Estimado: {selectedLiftSummary.exerciseName}
              </span>
              <span className="font-code-data text-xs text-on-surface-variant">
                {selectedLiftSummary.historyPoints.length} sesiones registradas
              </span>
            </div>

            <div className="w-full h-44 relative">
              <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 600 140">
                <line stroke="#bccac0" strokeDasharray="3 3" strokeOpacity="0.3" x1="0" x2="600" y1="20" y2="20" />
                <line stroke="#bccac0" strokeDasharray="3 3" strokeOpacity="0.3" x1="0" x2="600" y1="70" y2="70" />
                <line stroke="#bccac0" strokeDasharray="3 3" strokeOpacity="0.3" x1="0" x2="600" y1="120" y2="120" />

                {selectedLiftSummary.historyPoints.length > 1 ? (
                  <path
                    d={selectedLiftSummary.historyPoints.map((p, idx) => {
                      const numP = selectedLiftSummary.historyPoints.length;
                      const x = (idx / (numP - 1)) * 600;
                      const min = Math.min(...selectedLiftSummary.historyPoints.map(pt => pt.estimated1RM));
                      const max = Math.max(...selectedLiftSummary.historyPoints.map(pt => pt.estimated1RM));
                      const range = max - min || 1;
                      const y = 120 - ((p.estimated1RM - min) / range) * 90;
                      return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
                    }).join(' ')}
                    fill="none"
                    stroke="#006948"
                    strokeWidth="3"
                  />
                ) : null}

                {selectedLiftSummary.historyPoints.map((p, idx) => {
                  const numP = selectedLiftSummary.historyPoints.length;
                  const x = numP > 1 ? (idx / (numP - 1)) * 600 : 300;
                  const min = Math.min(...selectedLiftSummary.historyPoints.map(pt => pt.estimated1RM));
                  const max = Math.max(...selectedLiftSummary.historyPoints.map(pt => pt.estimated1RM));
                  const range = max - min || 1;
                  const y = numP > 1 ? 120 - ((p.estimated1RM - min) / range) * 90 : 70;

                  return (
                    <g key={`pt_${p.date}_${idx}`}>
                      <circle cx={x} cy={y} r="5" className="fill-primary stroke-2 stroke-surface-container-lowest" />
                    </g>
                  );
                })}
              </svg>

              <div className="flex justify-between text-on-surface-variant font-code-data text-xs pt-1">
                {selectedLiftSummary.historyPoints.map((p, idx) => (
                  <span key={`date_${p.date}_${idx}`} className="truncate">
                    {p.date.slice(5)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 6. Matriz de Récords Personales Reales */}
      <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pb-1 border-b border-surface-container/40">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-xl">emoji_events</span>
            <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
              Hitos y Récords Personales Reales (1RM Epley)
            </h2>
          </div>
          <span className="font-code-data text-code-data text-on-surface-variant text-xs">
            Warmups estrictamente excluidos de los PRs
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant font-label-sm uppercase tracking-wider">
                <th className="py-2.5 px-space-md rounded-l-lg">Fecha</th>
                <th className="py-2.5 px-space-md">Ejercicio</th>
                <th className="py-2.5 px-space-md text-right">Carga Lograda</th>
                <th className="py-2.5 px-space-md text-right">Repeticiones</th>
                <th className="py-2.5 px-space-md text-center">RIR Registrado</th>
                <th className="py-2.5 px-space-md text-right">1RM Calculado</th>
                <th className="py-2.5 px-space-md rounded-r-lg text-right">Sesión</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container font-body-md text-on-surface">
              {Object.values(exerciseProgressions).length > 0 ? (
                Object.values(exerciseProgressions).map(prog => (
                  <tr key={prog.canonicalId} className="hover:bg-surface-container-low transition-colors">
                    <td className="py-2.5 px-space-md font-code-data text-on-surface-variant">{prog.allTimeBestDate || '—'}</td>
                    <td className="py-2.5 px-space-md font-semibold flex items-center gap-space-xs">
                      <span className="h-2 w-2 rounded-full bg-primary" />
                      {prog.exerciseName}
                    </td>
                    <td className="py-2.5 px-space-md text-right font-code-data font-bold">{prog.allTimeBestWeightKg} kg</td>
                    <td className="py-2.5 px-space-md text-right font-code-data">{prog.allTimeBestReps} reps</td>
                    <td className="py-2.5 px-space-md text-center">
                      <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface font-code-data text-xs font-medium">
                        {prog.allTimeBestRir !== null ? `RIR ${prog.allTimeBestRir}` : 'RIR N/D'}
                      </span>
                    </td>
                    <td className="py-2.5 px-space-md text-right font-code-data font-semibold text-primary">{prog.allTimeBest1RM} kg</td>
                    <td className="py-2.5 px-space-md text-right font-code-data text-on-surface-variant">{prog.totalSessions} sesiones</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-on-surface-variant italic">
                    Sin registros suficientes en este período. Realiza un entrenamiento para registrar tus récords personales.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL DE EXPORTACIÓN PROFESIONAL PDF / CSV (Incremento 6E) */}
      <ExportWorkoutModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        executedWorkouts={executedWorkoutsHistory}
        workoutHistory={workoutHistory}
        userName={currentUser?.name || 'Atleta Vigor'}
        initialPeriod={selectedPeriod}
        onShowToast={showToast}
      />
    </div>
  );
};
