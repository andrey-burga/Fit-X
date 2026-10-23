import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { MealMoment } from '../../types';
import { FoodCategory, FoodItem, FoodPreparationState } from '../../types/nutrition';
import { NUTRITION_CATALOG } from '../../data/nutritionCatalog';
import {
  calculateRecipeNutrients,
  roundNutrients,
  searchFoods,
  formatNutrientValue,
} from '../../services/nutritionMath';

const CATEGORY_LABELS: Record<FoodCategory, string> = {
  carnes_aves: 'Carnes y Aves',
  pescados_mariscos: 'Pescados y Mariscos',
  huevos: 'Huevos y Derivados',
  lacteos: 'Lácteos y Derivados',
  cereales_granos: 'Cereales y Granos',
  tuberculos_raices: 'Tubérculos y Raíces',
  legumbres: 'Legumbres y Granos',
  frutas: 'Frutas',
  verduras_hortalizas: 'Verduras y Hortalizas',
  grasas_aceites: 'Grasas y Aceites',
  frutos_secos_semillas: 'Frutos Secos y Semillas',
  suplementos: 'Suplementos Deportivos',
};

const MOMENT_OPTIONS: Array<{ value: MealMoment; label: string }> = [
  { value: 'desayuno', label: 'Desayuno' },
  { value: 'almuerzo', label: 'Almuerzo' },
  { value: 'merienda', label: 'Merienda' },
  { value: 'cena', label: 'Cena' },
  { value: 'snack', label: 'Snack / Refrigerio' },
];

export const RecipeModal: React.FC = () => {
  const {
    isRecipeModalOpen,
    recipeModalData,
    closeRecipeModal,
    addRecipe,
    updateRecipe,
    showToast,
  } = useApp();

  const isEditing = recipeModalData?.mode === 'edit';
  const editingRecipe = recipeModalData?.recipe;

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [suggestedMoment, setSuggestedMoment] = useState<MealMoment>('almuerzo');
  const [servings, setServings] = useState<number>(1);
  const [prepTimeMinutes, setPrepTimeMinutes] = useState<number>(15);
  const [instructions, setInstructions] = useState('');
  const [imageUrl, setImageUrl] = useState('');

  // Selected Ingredients
  const [ingredients, setIngredients] = useState<
    Array<{ foodId: string; grams: number }>
  >([]);

  // Search and food selector
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);
  const [gramsInput, setGramsInput] = useState<number>(100);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initialize form when opening
  useEffect(() => {
    if (isRecipeModalOpen) {
      if (isEditing && editingRecipe) {
        setName(editingRecipe.name);
        setDescription(editingRecipe.description || '');
        setSuggestedMoment(editingRecipe.suggestedMoment);
        setServings(editingRecipe.servings || 1);
        setPrepTimeMinutes(editingRecipe.prepTimeMinutes || 15);
        setInstructions(editingRecipe.instructions || '');
        setImageUrl(editingRecipe.imageUrl || '');
        setIngredients(
          editingRecipe.ingredients.map(ing => ({
            foodId: ing.foodId,
            grams: ing.grams,
          }))
        );
      } else {
        setName('');
        setDescription('');
        setSuggestedMoment(recipeModalData?.initialMoment || 'almuerzo');
        setServings(1);
        setPrepTimeMinutes(15);
        setInstructions('');
        setImageUrl('');
        setIngredients([]);
      }
      setSearchQuery('');
      setSelectedCategory('all');
      setSelectedFood(null);
      setGramsInput(100);
      setIsSubmitting(false);
    }
  }, [isRecipeModalOpen, isEditing, editingRecipe, recipeModalData]);

  // Catalog search results
  const filteredCatalog = useMemo(() => {
    const categoryFilter =
      selectedCategory !== 'all' ? (selectedCategory as FoodCategory) : undefined;
    return searchFoods(searchQuery, { category: categoryFilter, limit: 30 });
  }, [searchQuery, selectedCategory]);

  // Real-time Nutrients calculation
  const calculatedNutrients = useMemo(() => {
    return calculateRecipeNutrients(ingredients, servings);
  }, [ingredients, servings]);

  const roundedTotal = useMemo(() => {
    return roundNutrients(calculatedNutrients.total, 1);
  }, [calculatedNutrients.total]);

  const roundedPerServing = useMemo(() => {
    return roundNutrients(calculatedNutrients.perServing, 1);
  }, [calculatedNutrients.perServing]);

  if (!isRecipeModalOpen) return null;

  const handleAddIngredient = () => {
    if (!selectedFood) {
      showToast('Selecciona un alimento del catálogo primero', 'warning');
      return;
    }
    if (gramsInput <= 0 || !Number.isFinite(gramsInput)) {
      showToast('Ingresa una cantidad en gramos válida mayor a 0', 'warning');
      return;
    }

    // Check if food already in list
    const existingIndex = ingredients.findIndex(i => i.foodId === selectedFood.id);
    if (existingIndex >= 0) {
      const updated = [...ingredients];
      updated[existingIndex].grams += gramsInput;
      setIngredients(updated);
      showToast(`Cantidad sumada a ${selectedFood.name}`, 'info');
    } else {
      setIngredients(prev => [...prev, { foodId: selectedFood.id, grams: gramsInput }]);
      showToast(`${selectedFood.name} añadido a la receta`, 'info');
    }

    setSelectedFood(null);
    setSearchQuery('');
    setGramsInput(100);
  };

  const handleRemoveIngredient = (foodId: string) => {
    setIngredients(prev => prev.filter(i => i.foodId !== foodId));
  };

  const handleUpdateIngredientGrams = (foodId: string, grams: number) => {
    if (grams <= 0) {
      handleRemoveIngredient(foodId);
      return;
    }
    setIngredients(prev =>
      prev.map(i => (i.foodId === foodId ? { ...i, grams } : i))
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || name.trim().length < 2) {
      showToast('El nombre de la receta debe tener al menos 2 caracteres', 'warning');
      return;
    }
    if (ingredients.length === 0) {
      showToast('Añade al menos un ingrediente del catálogo a la receta', 'warning');
      return;
    }

    setIsSubmitting(true);
    try {
      const detailedIngredients = calculatedNutrients.ingredientsBreakdown.map(ib => {
        const food = NUTRITION_CATALOG.find(f => f.id === ib.foodId);
        return {
          foodId: ib.foodId,
          foodName: ib.foodName,
          grams: ib.grams,
          preparationState: food?.state || ('cocido' as FoodPreparationState),
          nutrients: roundNutrients(ib.nutrients, 1),
          sourceFdcId: ib.sourceFdcId,
        };
      });

      const payload = {
        name: name.trim(),
        description: description.trim(),
        suggestedMoment,
        servings: Math.max(1, servings),
        prepTimeMinutes: Math.max(1, prepTimeMinutes),
        instructions: instructions.trim(),
        imageUrl: imageUrl.trim() || undefined,
        ingredients: detailedIngredients,
        totalNutrients: roundedTotal,
      };

      if (isEditing && editingRecipe) {
        await updateRecipe(editingRecipe.id, payload);
      } else {
        await addRecipe(payload);
      }

      closeRecipeModal();
    } catch (err: any) {
      showToast(err?.message || 'Error al guardar la receta', 'warning');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recipe-modal-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-scrim/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 md:p-6 animate-in fade-in duration-200"
    >
      <div className="bg-surface-container-lowest text-on-surface rounded-2xl shadow-xl border border-surface-container max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <header className="p-space-lg border-b border-surface-container flex items-center justify-between shrink-0 bg-surface-container-low">
          <div className="flex items-center gap-space-sm">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
              <span className="material-symbols-outlined text-2xl">menu_book</span>
            </div>
            <div>
              <h2
                id="recipe-modal-title"
                className="font-headline-sm text-headline-sm font-semibold text-on-surface"
              >
                {isEditing ? 'Editar Receta' : 'Crear Nueva Receta'}
              </h2>
              <p className="font-label-sm text-label-sm text-on-surface-variant">
                Biblioteca privada · Ingredientes verificados USDA FoodData Central
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeRecipeModal}
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-xl transition-colors cursor-pointer"
            aria-label="Cerrar modal de receta"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </header>

        {/* Form Body (Scrollable) */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-space-lg flex flex-col gap-space-lg">
          {/* Section 1: Basic Info */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-md">
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label htmlFor="recipe-name-input" className="font-label-sm text-label-sm font-semibold text-on-surface">
                Nombre de la Receta *
              </label>
              <input
                id="recipe-name-input"
                type="text"
                required
                maxLength={150}
                placeholder="Ej. Pechuga a la plancha con arroz y aguacate"
                value={name}
                onChange={e => setName(e.target.value)}
                className="px-space-md py-2.5 rounded-xl bg-surface-container-low border border-surface-container text-on-surface focus:outline-none focus:ring-2 focus:ring-primary font-body-md"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="recipe-moment-select" className="font-label-sm text-label-sm font-semibold text-on-surface">
                Momento de Consumo Sugerido *
              </label>
              <select
                id="recipe-moment-select"
                value={suggestedMoment}
                onChange={e => setSuggestedMoment(e.target.value as MealMoment)}
                className="px-space-md py-2.5 rounded-xl bg-surface-container-low border border-surface-container text-on-surface focus:outline-none focus:ring-2 focus:ring-primary font-body-md"
              >
                {MOMENT_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-space-sm">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="recipe-servings-input" className="font-label-sm text-label-sm font-semibold text-on-surface">
                  Porciones *
                </label>
                <input
                  id="recipe-servings-input"
                  type="number"
                  min={1}
                  max={20}
                  value={servings}
                  onChange={e => setServings(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="px-space-md py-2.5 rounded-xl bg-surface-container-low border border-surface-container text-on-surface focus:outline-none focus:ring-2 focus:ring-primary font-body-md"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="recipe-preptime-input" className="font-label-sm text-label-sm font-semibold text-on-surface">
                  Tiempo (mins)
                </label>
                <input
                  id="recipe-preptime-input"
                  type="number"
                  min={1}
                  max={300}
                  value={prepTimeMinutes}
                  onChange={e => setPrepTimeMinutes(Math.max(1, parseInt(e.target.value, 10) || 15))}
                  className="px-space-md py-2.5 rounded-xl bg-surface-container-low border border-surface-container text-on-surface focus:outline-none focus:ring-2 focus:ring-primary font-body-md"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5 md:col-span-2">
              <label htmlFor="recipe-desc-input" className="font-label-sm text-label-sm font-semibold text-on-surface">
                Descripción Breve
              </label>
              <input
                id="recipe-desc-input"
                type="text"
                placeholder="Ej. Plato fuerte hiperproteico ideal para el almuerzo post-entreno."
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="px-space-md py-2 rounded-xl bg-surface-container-low border border-surface-container text-on-surface focus:outline-none focus:ring-2 focus:ring-primary font-body-md text-sm"
              />
            </div>
          </div>

          {/* Section 2: Catalog Food Selector */}
          <div className="bg-surface-container-low p-space-md sm:p-space-lg rounded-2xl border border-surface-container flex flex-col gap-space-md">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-primary text-xl">search</span>
                <span className="font-headline-sm text-base font-semibold text-on-surface">
                  Añadir Ingrediente del Catálogo USDA
                </span>
              </div>
              <span className="font-label-sm text-xs bg-surface-container-high text-primary px-2 py-0.5 rounded-full font-code-data font-semibold">
                {NUTRITION_CATALOG.length} alimentos verificados
              </span>
            </div>

            {/* Search Input & Category Filter */}
            <div className="flex flex-col sm:flex-row gap-space-sm">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Buscar alimento (ej. pollo, arroz, huevo, aguacate)..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-surface-container-lowest border border-surface-container rounded-xl text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <span className="material-symbols-outlined text-base text-on-surface-variant absolute left-2.5 top-2.5">
                  search
                </span>
              </div>
              <select
                value={selectedCategory}
                onChange={e => setSelectedCategory(e.target.value)}
                className="px-space-md py-2 bg-surface-container-lowest border border-surface-container rounded-xl text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">Todas las categorías</option>
                {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {/* Search Results Pills */}
            <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5 p-1 border border-surface-container/60 rounded-xl bg-surface-container-lowest">
              {filteredCatalog.length === 0 ? (
                <div className="p-4 text-center text-on-surface-variant text-sm">
                  No se encontraron alimentos en el catálogo con los términos especificados.
                </div>
              ) : (
                filteredCatalog.map(food => {
                  const isSelected = selectedFood?.id === food.id;
                  return (
                    <button
                      key={food.id}
                      type="button"
                      onClick={() => setSelectedFood(food)}
                      className={`p-2.5 rounded-lg text-left flex items-center justify-between text-xs sm:text-sm transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-primary text-on-primary font-semibold shadow-xs'
                          : 'hover:bg-surface-container text-on-surface'
                      }`}
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{food.name}</span>
                        <span
                          className={`text-[11px] ${
                            isSelected ? 'text-on-primary/80' : 'text-on-surface-variant'
                          }`}
                        >
                          Estado: {food.state} · FDC ID: {food.source.fdcId}
                        </span>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <span className="font-code-data font-bold block">
                          {food.caloriesPer100g} kcal
                        </span>
                        <span
                          className={`text-[10px] ${
                            isSelected ? 'text-on-primary/80' : 'text-on-surface-variant'
                          }`}
                        >
                          P:{food.proteinPer100g}g · C:{food.carbsPer100g}g · G:{food.fatsPer100g}g
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Selected Food Action Bar */}
            {selectedFood && (
              <div className="p-space-md bg-surface-container rounded-xl border border-primary/30 flex flex-col sm:flex-row items-center justify-between gap-space-sm animate-in fade-in">
                <div className="flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    <span className="font-label-md text-label-md font-bold text-on-surface">
                      {selectedFood.name}
                    </span>
                  </div>
                  <span className="font-label-sm text-xs text-on-surface-variant block mt-0.5">
                    100g = {selectedFood.caloriesPer100g} kcal (P: {selectedFood.proteinPer100g}g · C: {selectedFood.carbsPer100g}g · G: {selectedFood.fatsPer100g}g)
                  </span>
                </div>

                <div className="flex items-center gap-space-sm w-full sm:w-auto">
                  <div className="flex items-center gap-1 bg-surface-container-lowest px-2 py-1 rounded-lg border border-surface-container">
                    <input
                      type="number"
                      min={1}
                      max={2000}
                      value={gramsInput}
                      onChange={e => setGramsInput(Math.max(1, parseInt(e.target.value, 10) || 0))}
                      className="w-16 font-code-data text-right font-bold text-on-surface bg-transparent focus:outline-none"
                    />
                    <span className="text-xs text-on-surface-variant font-medium">gramos</span>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddIngredient}
                    className="flex-1 sm:flex-initial px-space-md py-2 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold rounded-lg shadow-xs transition-colors flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-base">add</span>
                    <span>Añadir</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Section 3: Ingredients List Table */}
          <div className="flex flex-col gap-space-xs">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                Ingredientes en la Receta ({ingredients.length})
              </span>
              <span className="font-label-sm text-xs text-on-surface-variant">
                Total masa: {ingredients.reduce((acc, i) => acc + i.grams, 0)} g
              </span>
            </div>

            {ingredients.length === 0 ? (
              <div className="p-space-lg text-center bg-surface-container-low rounded-xl border border-dashed border-surface-container text-on-surface-variant text-sm">
                No has añadido ningún ingrediente todavía. Utiliza el buscador arriba para seleccionar alimentos del catálogo.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {calculatedNutrients.ingredientsBreakdown.map(ing => (
                  <div
                    key={ing.foodId}
                    className="p-space-md bg-surface-container-low rounded-xl border border-surface-container/60 flex items-center justify-between gap-space-sm"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-label-md text-label-md font-semibold text-on-surface truncate">
                          {ing.foodName}
                        </span>
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
                          USDA #{ing.sourceFdcId}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-on-surface-variant font-code-data mt-0.5">
                        <span className="font-semibold text-primary">
                          {formatNutrientValue(ing.nutrients.calories, 0, 'kcal')}
                        </span>
                        <span>P: {formatNutrientValue(ing.nutrients.protein, 1)}</span>
                        <span>C: {formatNutrientValue(ing.nutrients.carbs, 1)}</span>
                        <span>G: {formatNutrientValue(ing.nutrients.fats, 1)}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-space-sm">
                      <div className="flex items-center gap-1 bg-surface-container-lowest px-2 py-1 rounded-lg border border-surface-container">
                        <input
                          type="number"
                          min={1}
                          max={2000}
                          value={ing.grams}
                          onChange={e =>
                            handleUpdateIngredientGrams(
                              ing.foodId,
                              parseInt(e.target.value, 10) || 0
                            )
                          }
                          className="w-14 font-code-data text-right font-bold text-on-surface bg-transparent focus:outline-none text-xs"
                        />
                        <span className="text-[11px] text-on-surface-variant">g</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveIngredient(ing.foodId)}
                        className="p-1.5 text-on-surface-variant hover:text-error hover:bg-error-container/20 rounded-lg transition-colors cursor-pointer"
                        title="Eliminar ingrediente"
                      >
                        <span className="material-symbols-outlined text-base">delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Section 4: Real-time Consolidated Nutrition Card */}
          <div className="bg-surface-container-low p-space-md sm:p-space-lg rounded-2xl border border-surface-container flex flex-col gap-space-sm">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                Totales Consolidados en Tiempo Real
              </span>
              {servings > 1 && (
                <span className="font-label-sm text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
                  Mostrando total de {servings} porciones
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-space-sm text-center">
              <div className="bg-surface-container-lowest p-2.5 rounded-xl border border-surface-container">
                <span className="font-label-sm text-[11px] text-on-surface-variant block uppercase font-medium">
                  Calorías
                </span>
                <span className="font-metric-md text-metric-md font-bold text-primary block mt-0.5">
                  {roundedTotal.calories}
                </span>
                <span className="text-[10px] text-on-surface-variant">
                  {servings > 1 ? `${roundedPerServing.calories} / porción` : 'kcal'}
                </span>
              </div>

              <div className="bg-surface-container-lowest p-2.5 rounded-xl border border-surface-container">
                <span className="font-label-sm text-[11px] text-on-surface-variant block uppercase font-medium">
                  Proteína
                </span>
                <span className="font-metric-md text-metric-md font-bold text-on-surface block mt-0.5">
                  {roundedTotal.protein}g
                </span>
                <span className="text-[10px] text-on-surface-variant">
                  {servings > 1 ? `${roundedPerServing.protein}g / porción` : 'gramos'}
                </span>
              </div>

              <div className="bg-surface-container-lowest p-2.5 rounded-xl border border-surface-container">
                <span className="font-label-sm text-[11px] text-on-surface-variant block uppercase font-medium">
                  Carbohidratos
                </span>
                <span className="font-metric-md text-metric-md font-bold text-on-surface block mt-0.5">
                  {roundedTotal.carbs}g
                </span>
                <span className="text-[10px] text-on-surface-variant">
                  {servings > 1 ? `${roundedPerServing.carbs}g / porción` : 'gramos'}
                </span>
              </div>

              <div className="bg-surface-container-lowest p-2.5 rounded-xl border border-surface-container">
                <span className="font-label-sm text-[11px] text-on-surface-variant block uppercase font-medium">
                  Grasas
                </span>
                <span className="font-metric-md text-metric-md font-bold text-on-surface block mt-0.5">
                  {roundedTotal.fats}g
                </span>
                <span className="text-[10px] text-on-surface-variant">
                  {servings > 1 ? `${roundedPerServing.fats}g / porción` : 'gramos'}
                </span>
              </div>

              <div className="bg-surface-container-lowest p-2.5 rounded-xl border border-surface-container col-span-2 sm:col-span-1">
                <span className="font-label-sm text-[11px] text-on-surface-variant block uppercase font-medium">
                  Fibra
                </span>
                <span className="font-metric-md text-metric-md font-bold text-on-surface block mt-0.5">
                  {roundedTotal.fiber}g
                </span>
                <span className="text-[10px] text-on-surface-variant">
                  {servings > 1 ? `${roundedPerServing.fiber}g / porción` : 'gramos'}
                </span>
              </div>
            </div>
          </div>

          {/* Section 5: Preparation Instructions */}
          <div className="flex flex-col gap-1.5">
            <label htmlFor="recipe-instructions-input" className="font-label-sm text-label-sm font-semibold text-on-surface">
              Instrucciones de Preparación (Opcional)
            </label>
            <textarea
              id="recipe-instructions-input"
              rows={3}
              placeholder="1. Picar los ingredientes...&#10;2. Cocinar a fuego medio durante 10 minutos...&#10;3. Servir caliente."
              value={instructions}
              onChange={e => setInstructions(e.target.value)}
              className="px-space-md py-2.5 rounded-xl bg-surface-container-low border border-surface-container text-on-surface focus:outline-none focus:ring-2 focus:ring-primary font-body-md text-sm"
            />
          </div>
        </form>

        {/* Footer Actions */}
        <footer className="p-space-lg border-t border-surface-container flex items-center justify-end gap-space-sm shrink-0 bg-surface-container-low">
          <button
            type="button"
            onClick={closeRecipeModal}
            disabled={isSubmitting}
            className="px-space-lg py-2.5 rounded-xl text-on-surface hover:bg-surface-container font-label-md text-label-md font-medium transition-colors cursor-pointer"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || ingredients.length === 0 || !name.trim()}
            className={`px-space-xl py-2.5 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold rounded-xl shadow-sm transition-all flex items-center gap-2 cursor-pointer ${
              isSubmitting || ingredients.length === 0 || !name.trim()
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            {isSubmitting ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-on-primary border-t-transparent rounded-full animate-spin" />
                <span>Guardando...</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-base">save</span>
                <span>{isEditing ? 'Actualizar Receta' : 'Guardar Receta'}</span>
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
};
