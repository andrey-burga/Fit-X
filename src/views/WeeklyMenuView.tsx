import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { MealMoment } from '../types';
import { PlannedMealSlot } from '../types/nutrition';
import {
  getWeekDays,
  getWeekStartEnd,
  shiftWeek,
  formatSpanishDate,
  getLocalDateString,
} from '../services/dateUtils';

const MOMENT_ICONS: Record<MealMoment, string> = {
  desayuno: 'wb_twilight',
  almuerzo: 'sunny',
  merienda: 'local_cafe',
  cena: 'nights_stay',
  snack: 'nutrition',
};

const MOMENT_LABELS: Record<MealMoment, string> = {
  desayuno: 'DESAYUNO',
  almuerzo: 'ALMUERZO',
  merienda: 'MERIENDA',
  cena: 'CENA',
  snack: 'SNACK',
};

const MOMENT_TIMES: Record<MealMoment, string> = {
  desayuno: '08:00 AM',
  almuerzo: '01:15 PM',
  merienda: '05:00 PM',
  cena: '08:30 PM',
  snack: '11:00 AM',
};

const STANDARD_MOMENTS: MealMoment[] = ['desayuno', 'almuerzo', 'merienda', 'cena'];

export const WeeklyMenuView: React.FC = () => {
  const {
    navigate,
    showToast,
    groceries,
    recipes,
    currentMealPlan,
    activeWeekStart,
    setActiveWeekStart,
    openRecipeModal,
    openAssignModal,
    logPlannedMeal,
    syncMealPlanToGroceries,
    biometrics,
    hasBiometricsConfigured,
    mealLogs,
    selectedDate,
    setSelectedDate,
  } = useApp();

  const [viewMode, setViewMode] = useState<'detail' | 'matrix'>('detail');
  const [isSyncingGroceries, setIsSyncingGroceries] = useState(false);

  // Active Week calculation
  const weekRange = useMemo(() => getWeekStartEnd(activeWeekStart), [activeWeekStart]);
  const weekDays = useMemo(() => getWeekDays(activeWeekStart), [activeWeekStart]);

  // Selected Day in Weekly Menu view
  const [selectedDayDate, setSelectedDayDate] = useState<string>(() => {
    return '2024-10-24';
  });

  // Synchronize selected day when week changes if not present
  useEffect(() => {
    const exists = weekDays.some(d => d.dateStr === selectedDayDate);
    if (!exists) {
      const todayMatch = weekDays.find(d => d.isToday);
      setSelectedDayDate(todayMatch ? todayMatch.dateStr : weekDays[0].dateStr);
    }
  }, [weekDays, selectedDayDate]);

  // Day data computed from current weekly meal plan
  const computedWeekDays = useMemo(() => {
    return weekDays.map(d => {
      const dayPlan = currentMealPlan?.days?.[d.dateStr];
      let kcal = 0;
      let p = 0;
      let c = 0;
      let f = 0;
      let mealCount = 0;

      if (dayPlan?.meals) {
        Object.values(dayPlan.meals).forEach(slot => {
          if (slot) {
            kcal += slot.calories || 0;
            p += slot.protein || 0;
            c += slot.carbs || 0;
            f += slot.fats || 0;
            mealCount += 1;
          }
        });
      }

      return {
        ...d,
        label: d.dayLabel,
        dayFull: d.dayFull,
        type: dayPlan?.dayType || 'Día Regular de Entrenamiento',
        kcal: Math.round(kcal),
        p: Math.round(p * 10) / 10,
        c: Math.round(c * 10) / 10,
        f: Math.round(f * 10) / 10,
        mealCount,
        hasMeals: mealCount > 0,
      };
    });
  }, [weekDays, currentMealPlan]);

  const currentDayInfo = useMemo(() => {
    return computedWeekDays.find(d => d.dateStr === selectedDayDate) || computedWeekDays[3] || computedWeekDays[0];
  }, [computedWeekDays, selectedDayDate]);

  const currentDayPlan = currentMealPlan?.days?.[selectedDayDate];

  // Weekly Balance Aggregations
  const weeklyKpis = useMemo(() => {
    const activeDays = computedWeekDays.filter(d => d.hasMeals);
    const activeDaysCount = activeDays.length;
    const totalKcal = activeDays.reduce((acc, d) => acc + d.kcal, 0);
    const totalP = activeDays.reduce((acc, d) => acc + d.p, 0);

    const avgKcal = activeDaysCount > 0 ? Math.round(totalKcal / activeDaysCount) : 0;
    const avgP = activeDaysCount > 0 ? Math.round(totalP / activeDaysCount) : 0;

    let plannedSlotsCount = 0;
    computedWeekDays.forEach(d => {
      plannedSlotsCount += d.mealCount;
    });

    const totalPossibleSlots = 28; // 7 days * 4 standard meals
    const coveragePct = Math.min(100, Math.round((plannedSlotsCount / totalPossibleSlots) * 100));

    const targetKcal = hasBiometricsConfigured ? biometrics.targetCalories : 2300;
    const targetProtein = hasBiometricsConfigured ? biometrics.targetProteinG : 148;

    return {
      avgKcal,
      targetKcal,
      kcalDelta: avgKcal - targetKcal,
      avgP,
      targetProtein,
      plannedSlotsCount,
      totalPossibleSlots,
      coveragePct,
      activeDaysCount,
    };
  }, [computedWeekDays, hasBiometricsConfigured, biometrics]);

  // Groceries metrics
  const boughtGroceriesCount = groceries.filter(g => g.status === 'completed').length;
  const pendingGroceriesCount = groceries.length - boughtGroceriesCount;
  const groceryPct = groceries.length ? Math.round((boughtGroceriesCount / groceries.length) * 100) : 65;

  const handleWeekPrev = () => {
    const prevStart = shiftWeek(activeWeekStart, -1);
    setActiveWeekStart(prevStart);
    showToast(`Mostrando semana anterior`);
  };

  const handleWeekNext = () => {
    const nextStart = shiftWeek(activeWeekStart, 1);
    setActiveWeekStart(nextStart);
    showToast(`Mostrando semana siguiente`);
  };

  const handleWeekToday = () => {
    const { weekStart } = getWeekStartEnd();
    setActiveWeekStart(weekStart);
    const todayStr = getLocalDateString();
    setSelectedDayDate(todayStr);
    showToast(`Mostrando semana actual`);
  };

  const handleSyncGroceriesClick = async () => {
    setIsSyncingGroceries(true);
    try {
      await syncMealPlanToGroceries(currentMealPlan);
    } finally {
      setIsSyncingGroceries(false);
    }
  };

  const handleLogPlannedMealClick = async (moment: MealMoment, slot: PlannedMealSlot) => {
    try {
      await logPlannedMeal(selectedDayDate, moment, slot.recipeId);
      // Also update selected date in context so the athlete sees it in the dashboard
      setSelectedDate(selectedDayDate);
      showToast(`¡"${slot.recipeName}" registrada en tu diario de comidas!`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Error al registrar comida', 'warning');
    }
  };

  // Helper to test if a moment was already logged on this day
  const isMomentLoggedToday = (moment: MealMoment) => {
    return mealLogs.some(m => getLocalDateString(m.dateTime) === selectedDayDate && m.moment === moment);
  };

  return (
    <div className="p-4 sm:p-gutter-desktop flex flex-col gap-space-xl max-w-[1440px] mx-auto w-full animate-in fade-in duration-150">
      {/* Page Header & Global Menu Controls */}
      <section className="flex flex-col xl:flex-row xl:items-end justify-between gap-space-lg">
        <div className="flex flex-col gap-space-xs max-w-2xl">
          <div className="flex items-center gap-space-sm flex-wrap">
            <span className="font-label-sm text-label-sm text-primary uppercase tracking-wider bg-surface-container-high px-space-sm py-0.5 rounded-full font-semibold">
              Nutrición · Plan Semanal & Recetas
            </span>
            <div className="flex items-center gap-1.5 px-space-sm py-0.5 rounded-full bg-surface-container-lowest text-on-surface-variant shadow-xs text-label-sm font-code-data">
              <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span>{recipes.length} recetas en biblioteca · USDA FDC</span>
            </div>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface font-semibold tracking-tight">
            Menú Semanal Planificado
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Planificación alimentaria por momentos de consumo, recetas calculadas y sincronización con Lista de Compras.
          </p>
        </div>

        {/* Controls Matrix */}
        <div className="flex flex-wrap items-center gap-space-sm">
          {/* Week Navigator */}
          <div className="flex items-center bg-surface-container-lowest rounded-xl p-1 shadow-xs border border-surface-container/60">
            <button
              onClick={handleWeekPrev}
              className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer"
              title="Semana anterior"
              type="button"
            >
              <span className="material-symbols-outlined text-base">chevron_left</span>
            </button>
            <div className="px-space-sm flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-base text-primary">calendar_month</span>
              <span className="font-label-md text-label-md text-on-surface font-semibold whitespace-nowrap">
                {weekRange.label}
              </span>
            </div>
            <button
              onClick={handleWeekNext}
              className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer"
              title="Semana siguiente"
              type="button"
            >
              <span className="material-symbols-outlined text-base">chevron_right</span>
            </button>
            <button
              onClick={handleWeekToday}
              className="ml-1 px-space-sm py-1 rounded-lg text-label-sm font-label-sm font-semibold bg-surface-container-high hover:bg-surface-container-highest text-on-surface transition-colors cursor-pointer"
              type="button"
            >
              Hoy
            </button>
          </div>

          {/* View Switcher */}
          <div className="flex items-center bg-surface-container-lowest p-1 rounded-xl shadow-xs border border-surface-container/60">
            <button
              type="button"
              onClick={() => setViewMode('matrix')}
              className={`px-space-md py-1.5 rounded-lg text-label-md font-label-md font-medium transition-all cursor-pointer ${
                viewMode === 'matrix'
                  ? 'bg-primary text-on-primary shadow-xs font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Matriz Semanal
            </button>
            <button
              type="button"
              onClick={() => setViewMode('detail')}
              className={`px-space-md py-1.5 rounded-lg text-label-md font-label-md font-medium transition-all cursor-pointer ${
                viewMode === 'detail'
                  ? 'bg-primary text-on-primary shadow-xs font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Día Detallado
            </button>
          </div>

          {/* Actions */}
          <button
            onClick={() => showToast(`Reporte consolidado generado para ${weekRange.label}`, 'info')}
            className="p-2 bg-surface-container-lowest hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface rounded-xl shadow-xs border border-surface-container/60 transition-all flex items-center justify-center cursor-pointer"
            title="Exportar a PDF / Excel"
            type="button"
          >
            <span className="material-symbols-outlined text-lg">download</span>
          </button>
          <button
            onClick={() => openRecipeModal()}
            className="flex items-center gap-space-xs px-space-md py-2 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-label-md text-label-md font-medium shadow-sm transition-all cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined text-base">add_circle</span>
            <span>Nueva Receta</span>
          </button>
        </div>
      </section>

      {/* Weekly Balance KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-gutter-desktop">
        {/* KPI 1: Promedio Calórico */}
        <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
              Promedio Calórico Planificado
            </span>
            <span className="material-symbols-outlined text-lg text-primary">local_fire_department</span>
          </div>
          <div className="my-space-sm flex items-baseline gap-space-xs">
            <span className="font-metric-xl text-metric-xl text-on-surface font-bold tracking-tight">
              {weeklyKpis.avgKcal.toLocaleString()}
            </span>
            <span className="font-label-md text-label-md text-on-surface-variant">
              / {weeklyKpis.targetKcal.toLocaleString()} kcal
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden mr-space-sm">
              <div
                className="bg-primary h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, Math.round((weeklyKpis.avgKcal / (weeklyKpis.targetKcal || 1)) * 100))}%`,
                }}
              />
            </div>
            <span
              className={`font-code-data text-code-data font-semibold whitespace-nowrap ${
                weeklyKpis.kcalDelta >= 0 ? 'text-primary' : 'text-error'
              }`}
            >
              {weeklyKpis.kcalDelta >= 0 ? `+${weeklyKpis.kcalDelta}` : `${weeklyKpis.kcalDelta}`} kcal
            </span>
          </div>
        </div>

        {/* KPI 2: Proteínas Promedio */}
        <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
              Proteínas Promedio
            </span>
            <span className="material-symbols-outlined text-lg text-tertiary">fitness_center</span>
          </div>
          <div className="my-space-sm flex items-baseline gap-space-xs">
            <span className="font-metric-xl text-metric-xl text-on-surface font-bold tracking-tight">
              {weeklyKpis.avgP}
            </span>
            <span className="font-label-md text-label-md text-on-surface-variant">
              g / día (meta: {weeklyKpis.targetProtein}g)
            </span>
          </div>
          <div className="flex items-center gap-space-xs text-on-surface-variant font-label-sm text-label-sm">
            <span className="material-symbols-outlined text-sm text-primary">check_circle</span>
            <span>
              {weeklyKpis.avgP >= weeklyKpis.targetProtein
                ? 'Dentro de meta óptima de hipertrofia'
                : 'Planificación por debajo del objetivo'}
            </span>
          </div>
        </div>

        {/* KPI 3: Planificación */}
        <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
              Cobertura de Planificación
            </span>
            <span className="material-symbols-outlined text-lg text-primary">task_alt</span>
          </div>
          <div className="my-space-sm flex items-baseline gap-space-xs">
            <span className="font-metric-xl text-metric-xl text-primary font-bold tracking-tight">
              {weeklyKpis.coveragePct}%
            </span>
            <span className="font-label-md text-label-md text-on-surface-variant">completa</span>
          </div>
          <div className="flex items-center justify-between text-label-sm font-label-sm text-on-surface-variant">
            <span>{weeklyKpis.plannedSlotsCount} tomas programadas</span>
            <span className="font-code-data text-code-data text-on-surface font-semibold">
              {weeklyKpis.activeDaysCount}/7 días
            </span>
          </div>
        </div>

        {/* KPI 4: Lista de Compras */}
        <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant">
              Lista de Compras
            </span>
            <span className="material-symbols-outlined text-lg text-secondary">shopping_basket</span>
          </div>
          <div className="my-space-sm flex items-baseline gap-space-xs">
            <span className="font-metric-xl text-metric-xl text-on-surface font-bold tracking-tight">
              {groceries.length}
            </span>
            <span className="font-label-md text-label-md text-on-surface-variant">insumos requeridos</span>
          </div>
          <div className="flex items-center justify-between text-label-sm font-label-sm">
            <span className="text-primary font-medium">{boughtGroceriesCount} adquiridos</span>
            <span className="text-error font-medium">{pendingGroceriesCount} pendientes</span>
          </div>
        </div>
      </section>

      {/* Day-of-the-Week Selector */}
      <section className="flex flex-col gap-space-xs">
        <div className="flex items-center justify-between px-space-xs">
          <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold">
            Seleccionar Día de la Semana
          </span>
          <span className="font-code-data text-code-data text-on-surface-variant">
            Semana {weekRange.weekNumber} ({weekRange.weekStart} al {weekRange.weekEnd})
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-space-sm">
          {computedWeekDays.map(d => {
            const isSelected = selectedDayDate === d.dateStr;
            return (
              <button
                key={d.dateStr}
                type="button"
                onClick={() => setSelectedDayDate(d.dateStr)}
                className={`flex flex-col p-space-md rounded-xl text-left transition-all shadow-xs border cursor-pointer ${
                  isSelected
                    ? 'bg-primary text-on-primary border-primary shadow-md scale-[1.02]'
                    : 'bg-surface-container-lowest hover:bg-surface-container border-surface-container/60'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span
                    className={`font-label-md text-label-md font-bold ${
                      isSelected ? 'text-on-primary' : 'text-on-surface'
                    }`}
                  >
                    {d.dayLabel}
                  </span>
                  {d.isToday ? (
                    <span className="font-label-sm text-[10px] uppercase font-bold tracking-wider bg-primary-container text-on-primary-container px-1.5 py-0.5 rounded">
                      HOY
                    </span>
                  ) : (
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        d.hasMeals ? 'bg-primary' : 'bg-outline-variant'
                      }`}
                    />
                  )}
                </div>
                <span
                  className={`font-metric-md text-metric-md font-bold ${
                    isSelected ? 'text-on-primary' : 'text-on-surface'
                  }`}
                >
                  {d.kcal}
                </span>
                <span
                  className={`font-label-sm text-label-sm mt-0.5 ${
                    isSelected ? 'text-on-primary/90' : 'text-on-surface-variant'
                  }`}
                >
                  {d.hasMeals ? `kcal · P: ${d.p}g` : 'Sin comidas'}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* VIEW MODE 1: DAY DETAILED BREAKDOWN */}
      {viewMode === 'detail' && (
        <section className="flex flex-col gap-space-lg">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pb-space-xs">
            <div>
              <div className="flex items-center gap-space-sm flex-wrap">
                <h2 className="font-headline-md text-headline-md text-on-surface font-semibold">
                  Plan Detallado: {currentDayInfo.dayFull}
                </h2>
                <span className="px-space-sm py-0.5 rounded-md bg-surface-container-highest text-primary font-label-sm text-label-sm font-semibold">
                  {currentDayInfo.type}
                </span>
              </div>
              <p className="font-body-md text-body-md text-on-surface-variant mt-0.5">
                Meta diaria: {weeklyKpis.targetKcal} kcal · Planificado: {currentDayInfo.kcal} kcal
                {currentDayInfo.mealCount > 0
                  ? ` (${currentDayInfo.mealCount} momentos asignados)`
                  : ' (Sin comidas asignadas)'}
              </p>
            </div>

            {/* Day Macro Summary Pills */}
            <div className="flex items-center gap-space-sm bg-surface-container-lowest px-space-md py-2 rounded-xl shadow-xs border border-surface-container">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                <span className="font-label-md text-label-md text-on-surface font-semibold">
                  P: {currentDayInfo.p}g
                </span>
              </div>
              <span className="text-outline-variant">·</span>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-tertiary" />
                <span className="font-label-md text-label-md text-on-surface font-semibold">
                  C: {currentDayInfo.c}g
                </span>
              </div>
              <span className="text-outline-variant">·</span>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-secondary" />
                <span className="font-label-md text-label-md text-on-surface font-semibold">
                  G: {currentDayInfo.f}g
                </span>
              </div>
            </div>
          </div>

          {/* 4 Standard Meals Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-gutter-desktop">
            {STANDARD_MOMENTS.map((moment, idx) => {
              const slot = currentDayPlan?.meals?.[moment];
              const isLogged = isMomentLoggedToday(moment);
              const fullRecipe = slot ? recipes.find(r => r.id === slot.recipeId) : undefined;

              if (!slot) {
                // Empty slot card
                return (
                  <article
                    key={moment}
                    className="bg-surface-container-lowest rounded-xl shadow-xs border border-dashed border-surface-container/80 p-space-lg flex flex-col justify-between items-center text-center min-h-[380px] hover:border-primary/50 transition-colors"
                  >
                    <div className="w-full flex items-center justify-between pb-space-md border-b border-surface-container/40">
                      <div className="flex items-center gap-space-xs">
                        <span className="material-symbols-outlined text-base text-on-surface-variant">
                          {MOMENT_ICONS[moment]}
                        </span>
                        <span className="font-label-sm text-label-sm uppercase font-bold tracking-wider text-on-surface-variant">
                          {MOMENT_LABELS[moment]}
                        </span>
                      </div>
                      <span className="font-code-data text-code-data text-on-surface-variant text-xs">
                        {MOMENT_TIMES[moment]}
                      </span>
                    </div>

                    <div className="flex flex-col items-center justify-center my-auto gap-space-sm p-4">
                      <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant">
                        <span className="material-symbols-outlined text-2xl">restaurant</span>
                      </div>
                      <div>
                        <h4 className="font-headline-sm text-sm font-semibold text-on-surface">
                          Sin comida planificada
                        </h4>
                        <p className="font-body-md text-xs text-on-surface-variant mt-1 max-w-[200px]">
                          Asigna una receta de tu biblioteca para calcular automáticamente calorías y macros.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => openAssignModal(selectedDayDate, moment)}
                      className="w-full py-2.5 px-space-md bg-surface-container hover:bg-surface-container-high text-primary font-label-md text-label-md font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-base">add</span>
                      <span>Planificar {MOMENT_LABELS[moment].toLowerCase()}</span>
                    </button>
                  </article>
                );
              }

              // Planned Slot Card
              return (
                <article
                  key={moment}
                  className="bg-surface-container-lowest rounded-xl shadow-xs border border-surface-container/50 overflow-hidden flex flex-col justify-between hover:shadow-md transition-shadow"
                >
                  <div>
                    {/* Header bar */}
                    <div className="p-space-lg bg-surface-container-low flex flex-col gap-space-xs border-b border-surface-container/30">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-space-xs">
                          <span className="material-symbols-outlined text-base text-primary">
                            {MOMENT_ICONS[moment]}
                          </span>
                          <span className="font-label-sm text-label-sm uppercase font-bold tracking-wider text-on-surface">
                            {MOMENT_LABELS[moment]}
                          </span>
                        </div>
                        <span className="font-code-data text-code-data text-on-surface-variant font-medium">
                          {MOMENT_TIMES[moment]}
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between mt-1">
                        <span className="font-metric-md text-metric-md font-bold text-on-surface">
                          {slot.calories} kcal
                        </span>
                        <span className="font-label-sm text-label-sm text-on-surface-variant">
                          {slot.servings} porción ({Math.round(slot.protein)}g P)
                        </span>
                      </div>
                    </div>

                    {/* Image / Header Media */}
                    <div className="relative w-full h-36 bg-surface-container overflow-hidden">
                      {slot.imageUrl ? (
                        <img
                          className="w-full h-full object-cover"
                          alt={slot.recipeName}
                          src={slot.imageUrl}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-surface-container-high text-primary">
                          <span className="material-symbols-outlined text-4xl">soup_kitchen</span>
                        </div>
                      )}
                      <div className="absolute bottom-2 left-2 bg-inverse-surface/85 backdrop-blur-md px-2 py-0.5 rounded text-[11px] text-inverse-on-surface font-label-sm flex items-center gap-1">
                        <span>Comida {idx + 1} de 4</span>
                        {isLogged && <span className="text-primary font-bold">· Registrada</span>}
                      </div>
                    </div>

                    {/* Recipe Details */}
                    <div className="p-space-lg flex flex-col gap-space-md">
                      <div>
                        <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold leading-snug line-clamp-2">
                          {slot.recipeName}
                        </h3>
                        <span className="font-label-sm text-label-sm text-primary font-medium mt-0.5 inline-block">
                          Preparación · {slot.prepTimeMinutes || 15} mins
                        </span>
                      </div>

                      {/* Exact Ingredients Table */}
                      <div className="flex flex-col gap-space-xs pt-space-xs">
                        <span className="font-label-sm text-label-sm uppercase text-on-surface-variant font-semibold tracking-wider">
                          Ingredientes del Catálogo ({slot.ingredients?.length || 0})
                        </span>
                        <ul className="flex flex-col gap-1.5 text-body-md font-body-md text-on-surface max-h-36 overflow-y-auto pr-1">
                          {slot.ingredients?.map((ing, iIdx) => (
                            <li
                              key={`${ing.foodId}-${iIdx}`}
                              className="flex items-center justify-between text-[13px] py-1 border-b border-surface-container/60 last:border-b-0"
                            >
                              <span className="truncate pr-2">{ing.foodName}</span>
                              <span className="font-code-data text-code-data text-on-surface-variant font-semibold shrink-0">
                                {ing.grams}g
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* Macros and Card Actions */}
                  <div className="p-space-lg pt-0 flex flex-col gap-space-md">
                    <div className="grid grid-cols-3 gap-1 bg-surface-container-low p-2 rounded-lg text-center">
                      <div>
                        <span className="font-label-sm text-[10px] text-on-surface-variant uppercase block">
                          Prot
                        </span>
                        <span className="font-label-md text-label-md font-bold text-on-surface">
                          {Math.round(slot.protein)}g
                        </span>
                      </div>
                      <div>
                        <span className="font-label-sm text-[10px] text-on-surface-variant uppercase block">
                          Carb
                        </span>
                        <span className="font-label-md text-label-md font-bold text-on-surface">
                          {Math.round(slot.carbs)}g
                        </span>
                      </div>
                      <div>
                        <span className="font-label-sm text-[10px] text-on-surface-variant uppercase block">
                          Gras
                        </span>
                        <span className="font-label-md text-label-md font-bold text-on-surface">
                          {Math.round(slot.fats)}g
                        </span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col gap-space-xs pt-space-xs">
                      {/* Log in Daily Diary */}
                      <button
                        type="button"
                        onClick={() => handleLogPlannedMealClick(moment, slot)}
                        disabled={isLogged}
                        className={`w-full py-2 px-space-md rounded-xl text-label-sm font-label-sm font-semibold transition-all flex items-center justify-center gap-1.5 ${
                          isLogged
                            ? 'bg-primary/10 text-primary border border-primary/30 cursor-default opacity-90'
                            : 'bg-primary hover:bg-primary-container text-on-primary shadow-xs cursor-pointer'
                        }`}
                      >
                        <span className="material-symbols-outlined text-base">
                          {isLogged ? 'task_alt' : 'check_circle'}
                        </span>
                        <span>{isLogged ? 'Registrada en Diario' : 'Registrar en Diario'}</span>
                      </button>

                      <div className="flex items-center justify-between gap-space-xs">
                        <button
                          onClick={() => openAssignModal(selectedDayDate, moment, slot.recipeId)}
                          className="flex-1 py-1.5 px-space-xs bg-surface-container hover:bg-surface-container-high rounded-lg text-label-sm font-label-sm font-semibold text-on-surface transition-colors flex items-center justify-center gap-1 cursor-pointer"
                          type="button"
                          title="Cambiar receta para este horario"
                        >
                          <span className="material-symbols-outlined text-sm">swap_horiz</span>
                          <span>Cambiar</span>
                        </button>
                        <button
                          onClick={() => {
                            if (fullRecipe) {
                              openRecipeModal({ recipe: fullRecipe });
                            } else {
                              openRecipeModal();
                            }
                          }}
                          className="flex-1 py-1.5 px-space-xs bg-surface-container hover:bg-surface-container-high rounded-lg text-label-sm font-label-sm font-semibold text-on-surface transition-colors flex items-center justify-center gap-1 cursor-pointer"
                          type="button"
                          title="Editar receta en la biblioteca"
                        >
                          <span className="material-symbols-outlined text-sm">edit</span>
                          <span>Editar</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* VIEW MODE 2: WEEKLY MATRIX */}
      {viewMode === 'matrix' && (
        <section className="bg-surface-container-lowest p-space-lg rounded-2xl shadow-xs border border-surface-container/60 overflow-x-auto">
          <div className="min-w-[800px] flex flex-col gap-space-md">
            <div className="flex items-center justify-between pb-2 border-b border-surface-container">
              <div>
                <h3 className="font-headline-sm text-headline-sm font-semibold text-on-surface">
                  Matriz Semanal de Planificación
                </h3>
                <p className="font-body-md text-xs text-on-surface-variant">
                  Haz clic en cualquier comida para cambiarla o registrarla directamente.
                </p>
              </div>
              <span className="font-code-data text-xs bg-surface-container-high text-primary px-3 py-1 rounded-full font-semibold">
                {weeklyKpis.plannedSlotsCount} / 28 tomas
              </span>
            </div>

            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-surface-container">
                  <th className="p-2 text-xs uppercase font-semibold text-on-surface-variant w-28">
                    Momento
                  </th>
                  {computedWeekDays.map(d => (
                    <th
                      key={d.dateStr}
                      className={`p-2 text-center text-xs uppercase font-semibold cursor-pointer ${
                        selectedDayDate === d.dateStr
                          ? 'text-primary bg-primary/5 rounded-t-lg'
                          : 'text-on-surface'
                      }`}
                      onClick={() => {
                        setSelectedDayDate(d.dateStr);
                        setViewMode('detail');
                      }}
                    >
                      <div>{d.dayLabel}</div>
                      <div className="text-[10px] font-code-data font-normal text-on-surface-variant">
                        {d.kcal} kcal
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STANDARD_MOMENTS.map(moment => (
                  <tr key={moment} className="border-b border-surface-container/40">
                    <td className="p-2 font-label-sm text-xs font-bold uppercase text-on-surface-variant">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-sm text-primary">
                          {MOMENT_ICONS[moment]}
                        </span>
                        <span>{MOMENT_LABELS[moment]}</span>
                      </div>
                    </td>
                    {computedWeekDays.map(d => {
                      const slot = currentMealPlan?.days?.[d.dateStr]?.meals?.[moment];
                      return (
                        <td key={d.dateStr} className="p-1.5 text-center">
                          {slot ? (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDayDate(d.dateStr);
                                setViewMode('detail');
                              }}
                              className="w-full p-2 rounded-xl bg-surface-container-low hover:bg-surface-container border border-surface-container/60 text-left transition-all cursor-pointer group"
                            >
                              <span className="font-label-sm text-xs font-semibold text-on-surface block truncate group-hover:text-primary">
                                {slot.recipeName}
                              </span>
                              <span className="font-code-data text-[10px] text-on-surface-variant block mt-0.5">
                                {slot.calories} kcal · {Math.round(slot.protein)}g P
                              </span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openAssignModal(d.dateStr, moment)}
                              className="w-full py-3 px-1 rounded-xl border border-dashed border-surface-container text-on-surface-variant hover:text-primary hover:border-primary/50 text-[11px] font-medium transition-colors cursor-pointer"
                            >
                              + Asignar
                            </button>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Contextual Bottom Panels */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-gutter-desktop">
        {/* Shopping List Integration Banner */}
        <div className="lg:col-span-2 bg-surface-container-lowest p-space-lg rounded-xl shadow-xs border border-surface-container/50 flex flex-col md:flex-row items-center justify-between gap-space-lg">
          <div className="flex items-start gap-space-md">
            <div className="w-12 h-12 rounded-xl bg-surface-container-high flex items-center justify-center shrink-0 text-primary">
              <span className="material-symbols-outlined text-2xl">receipt_long</span>
            </div>
            <div className="flex flex-col gap-space-xs">
              <div className="flex items-center gap-space-xs">
                <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Vínculo directo con Lista de Compras
                </span>
                <span className="bg-surface-container-high text-primary font-code-data text-code-data px-2 py-0.5 rounded-full font-semibold">
                  Semana {weekRange.weekNumber}
                </span>
              </div>
              <p className="font-body-md text-body-md text-on-surface-variant max-w-xl">
                <strong className="text-on-surface font-semibold">{boughtGroceriesCount} insumos adquiridos</strong>,{' '}
                <span className="text-error font-medium">{pendingGroceriesCount} pendientes</span> en tu despensa para cubrir con precisión el menú de esta semana.
              </p>
              <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden mt-1 max-w-md">
                <div
                  className="bg-primary h-full rounded-full transition-all duration-300"
                  style={{ width: `${groceryPct}%` }}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-space-sm w-full md:w-auto">
            <button
              onClick={handleSyncGroceriesClick}
              disabled={isSyncingGroceries}
              className="flex-1 md:flex-initial flex items-center justify-center gap-space-xs px-space-md py-2.5 bg-surface-container hover:bg-surface-container-high text-on-surface rounded-xl font-label-md text-label-md font-medium shadow-xs transition-all whitespace-nowrap cursor-pointer"
              type="button"
            >
              <span className={`material-symbols-outlined text-base text-primary ${isSyncingGroceries ? 'animate-spin' : ''}`}>
                sync
              </span>
              <span>{isSyncingGroceries ? 'Sincronizando...' : 'Sincronizar Insumos'}</span>
            </button>
            <button
              onClick={() => navigate('lista-de-compras')}
              className="flex-1 md:flex-initial flex items-center justify-center gap-space-xs px-space-lg py-2.5 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-label-md text-label-md font-medium shadow-sm transition-all whitespace-nowrap cursor-pointer"
              type="button"
            >
              <span className="material-symbols-outlined text-base">shopping_cart</span>
              <span>Abrir Lista de Compras</span>
            </button>
          </div>
        </div>

        {/* Quick Food Substitutions Banner */}
        <div className="bg-surface-container-lowest p-space-lg rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-md">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-space-sm">
              <div className="w-10 h-10 rounded-xl bg-surface-container-high flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-xl">balance</span>
              </div>
              <div>
                <h4 className="font-label-md text-label-md font-bold text-on-surface">Opciones de Sustitución</h4>
                <span className="font-label-sm text-label-sm text-on-surface-variant">Equivalencias isocalóricas</span>
              </div>
            </div>
            <span className="font-code-data text-[11px] bg-surface-container-low px-2 py-0.5 rounded text-on-surface-variant font-medium">
              320+ ítems
            </span>
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant text-sm">
            ¿No dispones de salmón o batata hoy? Reemplaza cualquier ingrediente manteniendo idénticos macronutrientes.
          </p>
          <button
            onClick={() => navigate('sustituciones')}
            className="w-full flex items-center justify-between px-space-md py-2 bg-surface-container-low hover:bg-surface-container text-on-surface rounded-xl font-label-md text-label-md font-medium transition-colors cursor-pointer"
            type="button"
          >
            <span className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-base text-primary">tune</span>
              <span>Explorar catálogo de sustituciones</span>
            </span>
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </button>
        </div>
      </section>
    </div>
  );
};
