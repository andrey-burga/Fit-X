/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Weekly Meal Plan & Adaptive Nutritional Periodization View
 */

import React, { useMemo, useState } from 'react';
import { Check, RotateCcw, Sparkles } from 'lucide-react';
import type { AthleteGoal, MealMoment, MealPlanRecord } from '../contracts/cleanSlateModels';
import {
  computeAdaptivePeriodization,
  getRecentDateList,
  getTodayIsoDate,
} from '../domain/nutritionEngine';
import { estimateUtf8Bytes } from '../domain/validators';
import { useWorkspace } from '../state/WorkspaceContext';
import {
  InlineAlert,
  PayloadBudgetMeter,
  SectionCard,
  StatTile,
  StatePanel,
} from '../components/UiPrimitives';

const MOMENTS: MealMoment[] = ['desayuno', 'almuerzo', 'merienda', 'cena'];

export const MealPlanPeriodizationView: React.FC = () => {
  const { workspace, saveMealPlan, saveBiometrics, navigate } = useWorkspace();

  const [goal, setGoal] = useState<AthleteGoal>(workspace?.profile.goal ?? 'definicion');
  const [isDeloadWeek, setIsDeloadWeek] = useState<boolean>(false);
  const [dietBreakSelected, setDietBreakSelected] = useState<boolean>(false);
  const [carbShiftPct, setCarbShiftPct] = useState<number>(15);

  const periodization = useMemo(() => {
    if (!workspace?.biometrics) return null;
    return computeAdaptivePeriodization({
      goal,
      biometrics: workspace.biometrics,
      trainingDaysPerWeek: workspace.preferences?.trainingDaysPerWeek ?? 4,
      isDeloadWeek,
      dietBreakSelected,
      carbCyclingShiftPct: carbShiftPct,
    });
  }, [
    workspace?.biometrics,
    workspace?.preferences?.trainingDaysPerWeek,
    goal,
    isDeloadWeek,
    dietBreakSelected,
    carbShiftPct,
  ]);

  if (!workspace) return null;

  const activePlan: MealPlanRecord | undefined = workspace.mealPlans[0];
  const recipes = workspace.recipes;

  const handleCreateBlankPlan = async () => {
    const dates = getRecentDateList(7, getTodayIsoDate());
    const days: MealPlanRecord['days'] = {};
    dates.forEach((d, idx) => {
      days[d] = {
        date: d,
        dayLabel: `Día ${idx + 1} (${d.slice(5)})`,
        dayType: idx === 6 ? 'descanso' : 'estandar',
        meals: {},
      };
    });
    await saveMealPlan({
      weekStart: dates[0],
      weekEnd: dates[6],
      label: `Semana ${dates[0]} a ${dates[6]}`,
      days,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleAssignRecipe = async (dateKey: string, moment: MealMoment, recipeId: string) => {
    if (!activePlan) return;
    const nextPlan: MealPlanRecord = JSON.parse(JSON.stringify(activePlan));
    const day = nextPlan.days[dateKey];
    if (!day) return;

    if (!recipeId) {
      delete day.meals[moment];
    } else {
      const recipe = recipes.find(r => r.id === recipeId);
      if (!recipe) return;
      day.meals[moment] = {
        recipeId: recipe.id,
        recipeName: recipe.name,
        calories: recipe.totalNutrients.calories,
        protein: recipe.totalNutrients.protein,
        carbs: recipe.totalNutrients.carbs,
        fat: recipe.totalNutrients.fat,
        servings: 1,
      };
    }
    await saveMealPlan(nextPlan);
  };

  const handleApplyPeriodization = async () => {
    if (!workspace.biometrics || !periodization) return;
    const prev = workspace.biometrics;
    await saveBiometrics({
      ...periodization.proposedTargets,
      lastAppliedPeriodization: {
        phase: periodization.phaseLabel,
        athleteGoal: periodization.goal,
        appliedAt: new Date().toISOString(),
        isDietBreak: periodization.dietBreakApplied,
        previousTargets: {
          targetCalories: prev.targetCalories,
          targetProteinG: prev.targetProteinG,
          targetFatG: prev.targetFatG,
          targetCarbsG: prev.targetCarbsG,
          proteinPerKg: prev.proteinPerKg,
          fatPerKg: prev.fatPerKg,
          targetDeltaKcal: prev.targetDeltaKcal,
        },
      },
    });
  };

  const handleRevertPeriodization = async () => {
    const prev = workspace.biometrics?.lastAppliedPeriodization?.previousTargets;
    if (!workspace.biometrics || !prev) return;
    await saveBiometrics({
      ...workspace.biometrics,
      ...prev,
      lastAppliedPeriodization: undefined,
    });
  };

  const planBytes = activePlan ? estimateUtf8Bytes(activePlan) : 0;

  return (
    <div className="space-y-6">
      {/* Adaptive Nutritional Periodization */}
      <SectionCard
        title="Periodización Nutricional Adaptativa y Ciclado de Carbohidratos"
        subtitle="Calculado sin promesas pseudocientíficas; aplicación explícita y reversible"
      >
        {!periodization ? (
          <StatePanel
            mode="empty"
            title="Biometría requerida"
            description="Completa tu biometría para calcular recomendaciones adaptativas."
            actionLabel="Ir a Biometría"
            onAction={() => navigate('profile-biometrics')}
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Objetivo</span>
                <select
                  value={goal}
                  onChange={e => setGoal(e.target.value as AthleteGoal)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm"
                >
                  <option value="hipertrofia">Hipertrofia</option>
                  <option value="definicion">Definición</option>
                  <option value="recomposicion">Recomposición</option>
                  <option value="fuerza">Fuerza</option>
                  <option value="mantenimiento">Mantenimiento</option>
                </select>
              </label>

              <label className="text-xs font-medium text-ink space-y-1">
                <span>Ciclado Carbohidratos (%)</span>
                <input
                  type="number"
                  min={0}
                  max={25}
                  value={carbShiftPct}
                  onChange={e => setCarbShiftPct(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>

              <label className="flex items-center gap-2 text-xs font-medium text-ink p-2.5 rounded-lg border border-border bg-canvas cursor-pointer">
                <input
                  type="checkbox"
                  checked={isDeloadWeek}
                  onChange={e => {
                    setIsDeloadWeek(e.target.checked);
                    if (!e.target.checked) setDietBreakSelected(false);
                  }}
                />
                <span>Semana de descarga (Deload)</span>
              </label>

              {isDeloadWeek && (goal === 'definicion' || goal === 'perdida_grasa') && (
                <label className="flex items-center gap-2 text-xs font-medium text-ink p-2.5 rounded-lg border border-border bg-canvas cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dietBreakSelected}
                    onChange={e => setDietBreakSelected(e.target.checked)}
                  />
                  <span>Diet Break opcional (TDEE)</span>
                </label>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatTile
                label={periodization.dayTargets.highDemand.label}
                value={`${periodization.dayTargets.highDemand.calories} kcal`}
                detail={`${periodization.dayTargets.highDemand.proteinG}P · ${periodization.dayTargets.highDemand.carbsG}C (+${periodization.dayTargets.highDemand.carbShiftPct}%) · ${periodization.dayTargets.highDemand.fatG}G`}
                tone="brand"
              />
              <StatTile
                label={periodization.dayTargets.moderateDemand.label}
                value={`${periodization.dayTargets.moderateDemand.calories} kcal`}
                detail={`${periodization.dayTargets.moderateDemand.proteinG}P · ${periodization.dayTargets.moderateDemand.carbsG}C · ${periodization.dayTargets.moderateDemand.fatG}G`}
              />
              <StatTile
                label={periodization.dayTargets.restDay.label}
                value={`${periodization.dayTargets.restDay.calories} kcal`}
                detail={`${periodization.dayTargets.restDay.proteinG}P · ${periodization.dayTargets.restDay.carbsG}C (${periodization.dayTargets.restDay.carbShiftPct}%) · ${periodization.dayTargets.restDay.fatG}G`}
                tone="info"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="text-xs text-ink-muted">
                Media semanal isocalórica: <strong className="text-ink tabular-nums">{periodization.weeklyAverageCalories} kcal/día</strong> · {periodization.scientificNotes[0]}
              </div>
              <div className="flex items-center gap-2">
                {workspace.biometrics?.lastAppliedPeriodization?.previousTargets && (
                  <button
                    type="button"
                    onClick={() => void handleRevertPeriodization()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-ink hover:bg-surface-alt cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Revertir metas anteriores</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleApplyPeriodization()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-medium cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Aplicar metas propuestas</span>
                </button>
              </div>
            </div>

            {periodization.warnings.length > 0 && (
              <InlineAlert tone="warning">{periodization.warnings.join(' ')}</InlineAlert>
            )}
          </div>
        )}
      </SectionCard>

      {/* Weekly Meal Plan Matrix */}
      <SectionCard
        title={activePlan ? `Menú Semanal · ${activePlan.label}` : 'Planificador Semanal'}
        subtitle="Asigna recetas por día y momento; sincronizable a Lista de Compras"
        action={
          <div className="flex items-center gap-3">
            {activePlan && (
              <div className="w-44 hidden sm:block">
                <PayloadBudgetMeter bytes={planBytes} label="Documento MEAL_PLAN" />
              </div>
            )}
            <button
              type="button"
              onClick={() => navigate('shopping-list')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-canvas hover:bg-surface-alt text-xs font-medium cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 text-brand" />
              <span>Ir a Lista de Compras</span>
            </button>
          </div>
        }
      >
        {!activePlan ? (
          <StatePanel
            mode="empty"
            title="Sin menú semanal creado"
            description="Crea la estructura de 7 días para asignar tus recetas."
            actionLabel="Crear menú de esta semana"
            onAction={() => void handleCreateBlankPlan()}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {Object.values(activePlan.days).map(day => {
              const slots = Object.values(day.meals).filter(Boolean);
              const dayKcal = slots.reduce((s, slot) => s + (slot?.calories ?? 0), 0);
              const dayProt = Math.round(slots.reduce((s, slot) => s + (slot?.protein ?? 0), 0) * 10) / 10;

              return (
                <div key={day.date} className="border border-border rounded-xl p-3.5 bg-canvas space-y-3">
                  <div className="flex items-center justify-between border-b border-border pb-2">
                    <div>
                      <div className="text-sm font-semibold text-ink">{day.dayLabel}</div>
                      <div className="text-[11px] text-ink-muted capitalize">{day.dayType?.replace('_', ' ') ?? 'estándar'}</div>
                    </div>
                    <div className="text-right font-mono text-xs tabular-nums">
                      <div className="font-bold text-brand">{dayKcal} kcal</div>
                      <div className="text-ink-muted">{dayProt}g P</div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {MOMENTS.map(moment => {
                      const assigned = day.meals[moment];
                      return (
                        <label key={moment} className="block space-y-1">
                          <span className="text-[11px] font-semibold uppercase text-ink-muted">{moment}</span>
                          <select
                            value={assigned?.recipeId ?? ''}
                            onChange={e => void handleAssignRecipe(day.date, moment, e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg border border-border bg-surface text-xs text-ink"
                          >
                            <option value="">-- Vacío --</option>
                            {recipes.map(r => (
                              <option key={r.id} value={r.id}>
                                {r.name} ({r.totalNutrients.calories} kcal)
                              </option>
                            ))}
                          </select>
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>
    </div>
  );
};
