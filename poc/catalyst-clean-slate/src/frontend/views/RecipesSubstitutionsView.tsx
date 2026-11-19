/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Recipes Builder & Dynamic Food Substitutions View
 * Replaces static hardcoded substitution cards in root SubstitutionsView.tsx with live
 * nutritional equivalence calculations (isoprotein / isocarb / isocaloric) and 350 KB recipe budgeting.
 */

import React, { useMemo, useState } from 'react';
import { ArrowRightLeft, ChefHat, Plus, Scale, Trash2 } from 'lucide-react';
import type { MealMoment, RecipeIngredient, RecipeRecord } from '../contracts/cleanSlateModels';
import {
  FOOD_CATALOG,
  calculateFoodPortion,
  computeFoodSubstitution,
  getFoodById,
  type SubstitutionCriterion,
} from '../domain/nutritionEngine';
import { estimateUtf8Bytes } from '../domain/validators';
import { useWorkspace } from '../state/WorkspaceContext';
import { InlineAlert, PayloadBudgetMeter, SectionCard, StatePanel } from '../components/UiPrimitives';

export const RecipesSubstitutionsView: React.FC = () => {
  const { workspace, saveRecipe, deleteRecipe, isLocalDevMock } = useWorkspace();

  // Dynamic substitution state
  const [sourceFoodId, setSourceFoodId] = useState<string>('usda-pechuga-pollo');
  const [sourceGrams, setSourceGrams] = useState<number>(150);
  const [targetFoodId, setTargetFoodId] = useState<string>('usda-atun-agua');
  const [criterion, setCriterion] = useState<SubstitutionCriterion>('isoprotein');

  // Recipe builder state
  const [recipeName, setRecipeName] = useState<string>('');
  const [suggestedMoment, setSuggestedMoment] = useState<MealMoment>('almuerzo');
  const [servings, setServings] = useState<number>(1);
  const [prepMinutes, setPrepMinutes] = useState<number>(15);
  const [instructions, setInstructions] = useState<string>('');
  const [selectedFoodId, setSelectedFoodId] = useState<string>('usda-pechuga-pollo');
  const [ingredientGrams, setIngredientGrams] = useState<number>(150);
  const [draftIngredients, setDraftIngredients] = useState<RecipeIngredient[]>([
    (() => {
      const f = getFoodById('usda-pechuga-pollo')!;
      return { foodId: f.id, foodName: f.name, grams: 160, ...calculateFoodPortion(f, 160) };
    })(),
    (() => {
      const f = getFoodById('usda-arroz-basmati')!;
      return { foodId: f.id, foodName: f.name, grams: 80, ...calculateFoodPortion(f, 80) };
    })(),
  ]);
  const [savingRecipe, setSavingRecipe] = useState(false);

  const comparison = useMemo(
    () => computeFoodSubstitution(sourceFoodId, sourceGrams, targetFoodId, criterion),
    [sourceFoodId, sourceGrams, targetFoodId, criterion]
  );

  const draftTotals = useMemo(() => {
    return draftIngredients.reduce(
      (acc, ing) => ({
        calories: Math.round(acc.calories + ing.calories),
        protein: Math.round((acc.protein + ing.protein) * 10) / 10,
        carbs: Math.round((acc.carbs + ing.carbs) * 10) / 10,
        fat: Math.round((acc.fat + ing.fat) * 10) / 10,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
  }, [draftIngredients]);

  const draftRecipeCandidate: RecipeRecord = useMemo(
    () => ({
      id: 'draft_preview',
      name: recipeName.trim() || 'Receta en borrador',
      suggestedMoment,
      servings: Math.max(1, servings),
      prepTimeMinutes: Math.max(1, prepMinutes),
      ingredients: draftIngredients,
      totalNutrients: draftTotals,
      instructions: instructions.trim() || undefined,
      updatedAt: new Date().toISOString(),
    }),
    [recipeName, suggestedMoment, servings, prepMinutes, draftIngredients, draftTotals, instructions]
  );

  const draftBytes = useMemo(() => estimateUtf8Bytes(draftRecipeCandidate), [draftRecipeCandidate]);

  if (!workspace) return null;

  const handleAddIngredient = () => {
    const food = getFoodById(selectedFoodId);
    if (!food || ingredientGrams <= 0) return;
    const macros = calculateFoodPortion(food, ingredientGrams);
    setDraftIngredients(prev => [
      ...prev,
      {
        foodId: food.id,
        foodName: food.name,
        grams: Math.round(ingredientGrams),
        ...macros,
      },
    ]);
  };

  const handleRemoveIngredient = (index: number) => {
    setDraftIngredients(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleSaveRecipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!recipeName.trim() || draftIngredients.length === 0) return;
    setSavingRecipe(true);
    try {
      await saveRecipe({
        ...draftRecipeCandidate,
        id: `rec_${Date.now()}`,
        name: recipeName.trim(),
      });
      setRecipeName('');
      setInstructions('');
    } finally {
      setSavingRecipe(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Dynamic Food Substitution Calculator */}
      <SectionCard
        title="Calculadora Dinámica de Sustituciones Nutricionales"
        subtitle="Equivalencia calculada localmente sobre catálogo nutricional estático simulado (sin llamadas a APIs externas USDA)"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-end">
          <div className="lg:col-span-4 space-y-1">
            <label htmlFor="sub-source-food" className="text-xs font-medium text-ink-muted">
              Alimento Base
            </label>
            <select
              id="sub-source-food"
              value={sourceFoodId}
              onChange={e => setSourceFoodId(e.target.value)}
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
            >
              {FOOD_CATALOG.map(f => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.caloriesPer100g} kcal/100g)
                </option>
              ))}
            </select>
          </div>

          <div className="lg:col-span-2 space-y-1">
            <label htmlFor="sub-source-grams" className="text-xs font-medium text-ink-muted">
              Cantidad Base (g)
            </label>
            <input
              id="sub-source-grams"
              type="number"
              min={5}
              max={2000}
              value={sourceGrams}
              onChange={e => setSourceGrams(Math.max(1, Number(e.target.value) || 0))}
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink font-mono tabular-nums"
            />
          </div>

          <div className="lg:col-span-3 space-y-1">
            <label htmlFor="sub-criterion" className="text-xs font-medium text-ink-muted">
              Criterio de Equivalencia
            </label>
            <select
              id="sub-criterion"
              value={criterion}
              onChange={e => setCriterion(e.target.value as SubstitutionCriterion)}
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
            >
              <option value="isoprotein">Isoproteica (igual proteína)</option>
              <option value="isocarb">Isoglucídica (igual carbohidratos)</option>
              <option value="isocaloric">Isocalórica (iguales calorías)</option>
            </select>
          </div>

          <div className="lg:col-span-3 space-y-1">
            <label htmlFor="sub-target-food" className="text-xs font-medium text-ink-muted">
              Alimento Reemplazo
            </label>
            <select
              id="sub-target-food"
              value={targetFoodId}
              onChange={e => setTargetFoodId(e.target.value)}
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
            >
              {FOOD_CATALOG.map(f => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {comparison && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <div className="rounded-xl border border-border bg-surface-alt/50 p-4 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Origen · {comparison.sourceGrams} g
              </div>
              <div className="text-sm font-semibold text-ink">{comparison.sourceFood.name}</div>
              <div className="grid grid-cols-4 gap-2 text-xs font-mono tabular-nums pt-1">
                <div>
                  <span className="block text-ink-muted">kcal</span>
                  <strong className="text-ink">{comparison.sourceNutrients.calories}</strong>
                </div>
                <div>
                  <span className="block text-ink-muted">P</span>
                  <strong className="text-brand">{comparison.sourceNutrients.protein}g</strong>
                </div>
                <div>
                  <span className="block text-ink-muted">C</span>
                  <strong className="text-ink">{comparison.sourceNutrients.carbs}g</strong>
                </div>
                <div>
                  <span className="block text-ink-muted">G</span>
                  <strong className="text-ink">{comparison.sourceNutrients.fat}g</strong>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-brand/30 bg-brand-soft/40 p-4 flex flex-col justify-center items-center text-center gap-1.5">
              <ArrowRightLeft className="w-5 h-5 text-brand" aria-hidden="true" />
              <div className="text-xs text-ink-muted">Equivalencia calculada</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-brand">
                {comparison.targetGrams} g
              </div>
              <div className="text-xs text-ink-muted">
                Δ calórico:{' '}
                <span className="font-mono font-semibold text-ink">
                  {comparison.deltaCalories >= 0 ? `+${comparison.deltaCalories}` : comparison.deltaCalories} kcal
                </span>{' '}
                · Δ grasa:{' '}
                <span className="font-mono font-semibold text-ink">
                  {comparison.deltaFat >= 0 ? `+${comparison.deltaFat}` : comparison.deltaFat} g
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-surface-alt/50 p-4 space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                Reemplazo · {comparison.targetGrams} g
              </div>
              <div className="text-sm font-semibold text-ink">{comparison.targetFood.name}</div>
              <div className="grid grid-cols-4 gap-2 text-xs font-mono tabular-nums pt-1">
                <div>
                  <span className="block text-ink-muted">kcal</span>
                  <strong className="text-ink">{comparison.targetNutrients.calories}</strong>
                </div>
                <div>
                  <span className="block text-ink-muted">P</span>
                  <strong className="text-brand">{comparison.targetNutrients.protein}g</strong>
                </div>
                <div>
                  <span className="block text-ink-muted">C</span>
                  <strong className="text-ink">{comparison.targetNutrients.carbs}g</strong>
                </div>
                <div>
                  <span className="block text-ink-muted">G</span>
                  <strong className="text-ink">{comparison.targetNutrients.fat}g</strong>
                </div>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Recipe Builder + Saved Recipes */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <SectionCard
          className="lg:col-span-5"
          title="Constructor de Recetas"
          subtitle="Cálculo automático por porción y verificación de techo 350 KB"
        >
          <form onSubmit={e => void handleSaveRecipe(e)} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="rec-name" className="text-xs font-medium text-ink-muted">
                Nombre de la receta
              </label>
              <input
                id="rec-name"
                type="text"
                required
                placeholder="Ej. Bowl Post-Entreno de Pavo y Basmati"
                value={recipeName}
                onChange={e => setRecipeName(e.target.value)}
                className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <label htmlFor="rec-moment" className="text-xs font-medium text-ink-muted">
                  Momento
                </label>
                <select
                  id="rec-moment"
                  value={suggestedMoment}
                  onChange={e => setSuggestedMoment(e.target.value as MealMoment)}
                  className="w-full rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs text-ink"
                >
                  <option value="desayuno">Desayuno</option>
                  <option value="almuerzo">Almuerzo</option>
                  <option value="merienda">Merienda</option>
                  <option value="cena">Cena</option>
                  <option value="snack">Snack</option>
                </select>
              </div>
              <div className="space-y-1">
                <label htmlFor="rec-servings" className="text-xs font-medium text-ink-muted">
                  Porciones
                </label>
                <input
                  id="rec-servings"
                  type="number"
                  min={1}
                  max={20}
                  value={servings}
                  onChange={e => setServings(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs text-ink font-mono"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="rec-prep" className="text-xs font-medium text-ink-muted">
                  Prep (min)
                </label>
                <input
                  id="rec-prep"
                  type="number"
                  min={1}
                  max={240}
                  value={prepMinutes}
                  onChange={e => setPrepMinutes(Math.max(1, Number(e.target.value) || 1))}
                  className="w-full rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs text-ink font-mono"
                />
              </div>
            </div>

            <div className="border-t border-border pt-3 space-y-2">
              <div className="text-xs font-semibold text-ink">Añadir ingredientes del catálogo local simulado</div>
              <div className="flex flex-col sm:flex-row gap-2">
                <select
                  aria-label="Ingrediente a añadir"
                  value={selectedFoodId}
                  onChange={e => setSelectedFoodId(e.target.value)}
                  className="flex-1 rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs text-ink"
                >
                  {FOOD_CATALOG.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <input
                    aria-label="Gramos de ingrediente"
                    type="number"
                    min={1}
                    max={2000}
                    value={ingredientGrams}
                    onChange={e => setIngredientGrams(Math.max(1, Number(e.target.value) || 0))}
                    className="w-24 rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs text-ink font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleAddIngredient}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-lg border border-border bg-surface-alt hover:bg-canvas text-xs font-medium text-ink cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Añadir</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5 max-h-48 overflow-y-auto pt-1">
                {draftIngredients.map((ing, idx) => (
                  <div
                    key={`${ing.foodId}_${idx}`}
                    className="flex items-center justify-between gap-2 text-xs bg-surface-alt/60 border border-border rounded-lg px-2.5 py-1.5"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-ink truncate">{ing.foodName}</div>
                      <div className="text-[11px] text-ink-muted font-mono tabular-nums">
                        {ing.grams}g · {ing.calories} kcal · P {ing.protein}g · C {ing.carbs}g · G {ing.fat}g
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveIngredient(idx)}
                      aria-label={`Quitar ${ing.foodName}`}
                      className="text-ink-muted hover:text-danger p-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-canvas border border-border p-3 text-xs space-y-1.5">
              <div className="flex items-center justify-between font-semibold text-ink">
                <span className="flex items-center gap-1.5">
                  <Scale className="w-3.5 h-3.5 text-brand" />
                  Total por porción ({servings} porción/es)
                </span>
                <span className="font-mono tabular-nums text-brand">
                  {Math.round(draftTotals.calories / Math.max(1, servings))} kcal
                </span>
              </div>
              <div className="text-ink-muted font-mono tabular-nums">
                P {Math.round((draftTotals.protein / Math.max(1, servings)) * 10) / 10}g · C{' '}
                {Math.round((draftTotals.carbs / Math.max(1, servings)) * 10) / 10}g · G{' '}
                {Math.round((draftTotals.fat / Math.max(1, servings)) * 10) / 10}g
              </div>
              <PayloadBudgetMeter bytes={draftBytes} label="Tamaño estimado del ítem RECIPE" />
            </div>

            <textarea
              aria-label="Instrucciones de preparación"
              rows={2}
              placeholder="Instrucciones breves de preparación (opcional)..."
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink"
            />

            <button
              type="submit"
              disabled={savingRecipe || !recipeName.trim() || draftIngredients.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-sm font-medium cursor-pointer transition-colors"
            >
              <ChefHat className="w-4 h-4" />
              <span>
                {savingRecipe
                  ? 'Guardando...'
                  : isLocalDevMock
                    ? 'Guardar Receta en Mock Local'
                    : 'Guardar Receta vía Adaptador HTTP'}
              </span>
            </button>
          </form>
        </SectionCard>

        <SectionCard
          className="lg:col-span-7"
          title={`Recetario Activo (${workspace.recipes.length})`}
          subtitle="Las recetas guardadas alimentan el plan semanal y la sincronización idempotente de compras"
        >
          {workspace.recipes.length === 0 ? (
            <StatePanel
              mode="empty"
              title="Sin recetas guardadas"
              description="Crea una receta en el constructor para planificar comidas y generar tu lista de compras."
            />
          ) : (
            <div className="space-y-3">
              <InlineAlert tone="info">
                En desarrollo local las recetas viven en memoria RAM; en Catalyst futuro persistirán como entidad <code>RECIPE</code> particionada bajo <code>PK = USER#uid</code> sin sobrepasar el presupuesto seguro de 350 KB.
              </InlineAlert>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {workspace.recipes.map(recipe => {
                  const perServingKcal = Math.round(recipe.totalNutrients.calories / Math.max(1, recipe.servings));
                  return (
                    <article
                      key={recipe.id}
                      className="rounded-xl border border-border bg-surface-alt/40 p-4 flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-semibold text-ink">{recipe.name}</h3>
                            <p className="text-xs text-ink-muted capitalize">
                              {recipe.suggestedMoment} · {recipe.servings} porción(es) · {recipe.prepTimeMinutes} min
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void deleteRecipe(recipe.id)}
                            aria-label={`Eliminar receta ${recipe.name}`}
                            className="p-1.5 rounded-lg text-ink-muted hover:text-danger hover:bg-surface cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="grid grid-cols-4 gap-1.5 text-xs font-mono tabular-nums bg-surface border border-border rounded-lg p-2">
                          <div>
                            <span className="block text-[10px] text-ink-muted">kcal</span>
                            <strong className="text-ink">{perServingKcal}</strong>
                          </div>
                          <div>
                            <span className="block text-[10px] text-ink-muted">Prot</span>
                            <strong className="text-brand">{recipe.totalNutrients.protein}g</strong>
                          </div>
                          <div>
                            <span className="block text-[10px] text-ink-muted">Carb</span>
                            <strong className="text-ink">{recipe.totalNutrients.carbs}g</strong>
                          </div>
                          <div>
                            <span className="block text-[10px] text-ink-muted">Grasa</span>
                            <strong className="text-ink">{recipe.totalNutrients.fat}g</strong>
                          </div>
                        </div>

                        <ul className="text-xs text-ink-muted space-y-0.5">
                          {recipe.ingredients.map((ing, i) => (
                            <li key={`${recipe.id}_${ing.foodId}_${i}`} className="truncate">
                              • {ing.foodName} ({ing.grams} g)
                            </li>
                          ))}
                        </ul>
                      </div>
                      {recipe.instructions && (
                        <p className="text-xs text-ink-muted border-t border-border pt-2">
                          {recipe.instructions}
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};
