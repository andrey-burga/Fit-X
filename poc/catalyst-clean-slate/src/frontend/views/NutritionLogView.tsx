/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Consolidated Meal Logger & Daily Compliance Timeline
 * Replaces redundant root MealLogView + hardcoded DailyLogView with real, non-NULL-biased metrics.
 */

import React, { useMemo, useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import type { MealMoment } from '../contracts/cleanSlateModels';
import {
  calculateFoodPortion,
  FOOD_CATALOG,
  getFoodById,
  getRecentDateList,
  getTodayIsoDate,
  groupMealLogsByDate,
} from '../domain/nutritionEngine';
import { useWorkspace } from '../state/WorkspaceContext';
import { InlineAlert, SectionCard, StatTile, StatePanel } from '../components/UiPrimitives';

export const NutritionLogView: React.FC = () => {
  const { workspace, logMeal, deleteMeal, todayMacros } = useWorkspace();
  const today = getTodayIsoDate();

  const [momentFilter, setMomentFilter] = useState<'all' | MealMoment>('all');
  const [rangeDays, setRangeDays] = useState<number>(7);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Quick meal form state
  const [dateTime, setDateTime] = useState<string>(`${today}T12:30`);
  const [moment, setMoment] = useState<MealMoment>('almuerzo');
  const [selectedFoodId, setSelectedFoodId] = useState<string>('');
  const [grams, setGrams] = useState<number>(150);
  const [mealName, setMealName] = useState<string>('');
  const [kcal, setKcal] = useState<number>(0);
  const [protein, setProtein] = useState<number>(0);
  const [carbs, setCarbs] = useState<number>(0);
  const [fat, setFat] = useState<number>(0);
  const [formError, setFormError] = useState<string | null>(null);

  const datesWindow = useMemo(() => getRecentDateList(rangeDays, today), [rangeDays, today]);

  const dailyCompliance = useMemo(
    () => groupMealLogsByDate(workspace?.mealLogs ?? [], datesWindow),
    [workspace?.mealLogs, datesWindow]
  );

  const filteredMeals = useMemo(() => {
    const allowedDates = new Set(datesWindow);
    const q = searchQuery.trim().toLowerCase();
    return (workspace?.mealLogs ?? []).filter(m => {
      const dateStr = m.dateTime.slice(0, 10);
      if (rangeDays < 30 && !allowedDates.has(dateStr)) return false;
      if (momentFilter !== 'all' && m.moment !== momentFilter) return false;
      if (q && !m.name.toLowerCase().includes(q) && !m.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [workspace?.mealLogs, datesWindow, rangeDays, momentFilter, searchQuery]);

  if (!workspace) return null;

  const handlePickFood = (foodId: string, newGrams = grams) => {
    setSelectedFoodId(foodId);
    const food = getFoodById(foodId);
    if (!food) return;
    const calc = calculateFoodPortion(food, newGrams);
    setMealName(`${food.name} (${newGrams} g)`);
    setKcal(calc.calories);
    setProtein(calc.protein);
    setCarbs(calc.carbs);
    setFat(calc.fat);
  };

  const handleSubmitMeal = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await logMeal({
        dateTime,
        moment,
        name: mealName,
        description: selectedFoodId ? `Calculado desde catálogo local simulado (${grams} g)` : 'Registro manual',
        portion: `${grams} g`,
        kcal: Number(kcal),
        protein: Number(protein),
        carbs: Number(carbs),
        fat: Number(fat),
        source: 'Manual',
        foodId: selectedFoodId || undefined,
        grams: selectedFoodId ? grams : undefined,
      });
      setMealName('');
      setSelectedFoodId('');
      setKcal(0);
      setProtein(0);
      setCarbs(0);
      setFat(0);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Datos de comida inválidos');
    }
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(filteredMeals, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vigorcore_comidas_${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loggedDaysCount = dailyCompliance.filter(d => d.status === 'logged').length;
  const loggedAvgKcal = loggedDaysCount > 0
    ? Math.round(dailyCompliance.reduce((s, d) => s + (d.calories ?? 0), 0) / loggedDaysCount)
    : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Ingesta Hoy" value={`${todayMacros.calories} kcal`} detail={`${todayMacros.mealsCount} comidas`} tone="brand" />
        <StatTile label="Proteína Hoy" value={`${todayMacros.protein} g`} detail={`Carbs ${todayMacros.carbs}g · Grasas ${todayMacros.fat}g`} />
        <StatTile
          label={`Días Registrados (${rangeDays}d)`}
          value={`${loggedDaysCount} / ${rangeDays}`}
          detail="Días sin registros = NULL (no 0 kcal)"
          tone="info"
        />
        <StatTile
          label="Promedio Días Activos"
          value={loggedAvgKcal !== null ? `${loggedAvgKcal} kcal` : 'Sin datos'}
          detail="Excluye días sin registro"
        />
      </div>

      {/* Meal Logger Form */}
      <SectionCard
        title="Registrar Nueva Comida"
        subtitle="Validación estricta de fecha YYYY-MM-DDTHH:mm y macronutrientes [0..10000]"
      >
        {formError && <InlineAlert tone="error">{formError}</InlineAlert>}
        <form onSubmit={e => void handleSubmitMeal(e)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-xs font-medium text-ink space-y-1">
              <span>Autocompletar desde catálogo local (simulado)</span>
              <select
                value={selectedFoodId}
                onChange={e => handlePickFood(e.target.value, grams)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm"
              >
                <option value="">-- Ingreso manual --</option>
                {FOOD_CATALOG.map(f => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.caloriesPer100g} kcal/100g)
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-ink space-y-1">
              <span>Gramos (porción)</span>
              <input
                type="number"
                min={1}
                value={grams}
                onChange={e => {
                  const g = Number(e.target.value);
                  setGrams(g);
                  if (selectedFoodId) handlePickFood(selectedFoodId, g);
                }}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
              />
            </label>
            <label className="text-xs font-medium text-ink space-y-1">
              <span>Momento</span>
              <select
                value={moment}
                onChange={e => setMoment(e.target.value as MealMoment)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm"
              >
                <option value="desayuno">Desayuno</option>
                <option value="almuerzo">Almuerzo</option>
                <option value="merienda">Merienda</option>
                <option value="cena">Cena</option>
                <option value="snack">Snack</option>
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
            <label className="sm:col-span-2 text-xs font-medium text-ink space-y-1">
              <span>Nombre de comida</span>
              <input
                type="text"
                value={mealName}
                onChange={e => setMealName(e.target.value)}
                placeholder="Ej. Pechuga con arroz basmati"
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm"
                required
              />
            </label>
            <label className="text-xs font-medium text-ink space-y-1">
              <span>Fecha/Hora</span>
              <input
                type="datetime-local"
                value={dateTime}
                onChange={e => setDateTime(e.target.value)}
                className="w-full px-2.5 py-2 rounded-lg border border-border bg-canvas text-xs tabular-nums"
                required
              />
            </label>
            <label className="text-xs font-medium text-ink space-y-1">
              <span>kcal</span>
              <input
                type="number"
                value={kcal}
                onChange={e => setKcal(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
              />
            </label>
            <label className="text-xs font-medium text-ink space-y-1">
              <span>Prot (g)</span>
              <input
                type="number"
                step="0.1"
                value={protein}
                onChange={e => setProtein(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Carb (g)</span>
                <input
                  type="number"
                  step="0.1"
                  value={carbs}
                  onChange={e => setCarbs(Number(e.target.value))}
                  className="w-full px-2 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Grasa (g)</span>
                <input
                  type="number"
                  step="0.1"
                  value={fat}
                  onChange={e => setFat(Number(e.target.value))}
                  className="w-full px-2 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>
            </div>
          </div>

          <button
            type="submit"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Registrar comida</span>
          </button>
        </form>
      </SectionCard>

      {/* Consolidated Daily Compliance Matrix */}
      <SectionCard
        title="Cumplimiento Diario (Consolidado sin sesgo de ceros)"
        subtitle="Ventana móvil calculada estrictamente sobre registros reales"
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {dailyCompliance.slice(-7).map(day => (
            <div
              key={day.date}
              className={`p-3 rounded-lg border text-xs ${
                day.status === 'logged'
                  ? 'border-brand/40 bg-brand-soft/30'
                  : 'border-border bg-canvas text-ink-muted'
              }`}
            >
              <div className="font-mono font-semibold text-ink">{day.date.slice(5)}</div>
              {day.status === 'logged' ? (
                <div className="mt-1 space-y-0.5 tabular-nums">
                  <div className="font-bold text-brand">{day.calories} kcal</div>
                  <div>{day.protein}g P · {day.mealsCount} tomas</div>
                </div>
              ) : (
                <div className="mt-1 text-ink-muted">Sin registros (NULL)</div>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Filterable Meal History */}
      <SectionCard
        title="Historial de Comidas"
        subtitle={`${filteredMeals.length} registro(s) encontrados`}
        action={
          <button
            type="button"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-canvas hover:bg-surface-alt text-xs font-medium cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar JSON</span>
          </button>
        }
      >
        <div className="flex flex-wrap gap-2">
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Filtrar por nombre..."
            className="px-3 py-1.5 rounded-lg border border-border bg-canvas text-xs min-w-48"
          />
          <select
            aria-label="Filtrar por momento"
            value={momentFilter}
            onChange={e => setMomentFilter(e.target.value as 'all' | MealMoment)}
            className="px-3 py-1.5 rounded-lg border border-border bg-canvas text-xs"
          >
            <option value="all">Todos los momentos</option>
            <option value="desayuno">Desayuno</option>
            <option value="almuerzo">Almuerzo</option>
            <option value="merienda">Merienda</option>
            <option value="cena">Cena</option>
            <option value="snack">Snack</option>
          </select>
          <select
            aria-label="Filtrar por rango de días"
            value={rangeDays}
            onChange={e => setRangeDays(Number(e.target.value))}
            className="px-3 py-1.5 rounded-lg border border-border bg-canvas text-xs"
          >
            <option value={1}>Solo hoy</option>
            <option value={7}>Últimos 7 días</option>
            <option value={30}>Todo el historial</option>
          </select>
        </div>

        {filteredMeals.length === 0 ? (
          <StatePanel
            mode="empty"
            title="Sin comidas en el rango seleccionado"
            description="Registra una comida arriba o amplía los filtros de fecha o momento."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-border text-xs text-ink-muted uppercase">
                  <th className="py-2 pr-3">Fecha</th>
                  <th className="py-2 pr-3">Momento</th>
                  <th className="py-2 pr-3">Comida</th>
                  <th className="py-2 pr-3 text-right">kcal</th>
                  <th className="py-2 pr-3 text-right">P / C / G</th>
                  <th className="py-2 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filteredMeals.map(m => (
                  <tr key={m.id} className="hover:bg-surface-alt/40">
                    <td className="py-2.5 pr-3 font-mono text-xs tabular-nums text-ink-muted">
                      {m.dateTime.replace('T', ' ')}
                    </td>
                    <td className="py-2.5 pr-3 capitalize text-xs font-medium">{m.moment}</td>
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-ink">{m.name}</div>
                      <div className="text-xs text-ink-muted">{m.description}</div>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono font-semibold tabular-nums">
                      {m.kcal}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono text-xs tabular-nums text-ink-muted">
                      {m.protein}g / {m.carbs}g / {m.fat}g
                    </td>
                    <td className="py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void deleteMeal(m.id)}
                        aria-label={`Eliminar ${m.name}`}
                        className="p-1.5 rounded text-ink-muted hover:text-danger hover:bg-danger-soft cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
};
