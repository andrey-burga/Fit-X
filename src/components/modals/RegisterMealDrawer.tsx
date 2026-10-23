import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { MealMoment } from '../../types';
import { FoodCategory, FoodItem } from '../../types/nutrition';
import { NUTRITION_CATALOG } from '../../data/nutritionCatalog';
import { calculateNutrients, roundNutrients, searchFoods } from '../../services/nutritionMath';

const CATEGORY_LABELS: Record<FoodCategory, string> = {
  carnes_aves: 'Carnes y Aves',
  pescados_mariscos: 'Pescados y Mariscos',
  huevos: 'Huevos',
  lacteos: 'Lácteos',
  cereales_granos: 'Cereales y Granos',
  tuberculos_raices: 'Tubérculos y Raíces',
  legumbres: 'Legumbres',
  frutas: 'Frutas',
  verduras_hortalizas: 'Verduras y Hortalizas',
  grasas_aceites: 'Grasas y Aceites',
  frutos_secos_semillas: 'Frutos Secos y Semillas',
  suplementos: 'Suplementos',
};

export const RegisterMealDrawer: React.FC = () => {
  const { isMealDrawerOpen, closeMealDrawer, addMealLog, mealDrawerMoment, selectedDate } = useApp();

  // Current ISO date-time formatted for datetime-local input based on selectedDate
  const defaultDateTime = useMemo(() => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const baseDate = selectedDate || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return `${baseDate}T${timeStr}`;
  }, [selectedDate]);

  const [dateTime, setDateTime] = useState(defaultDateTime);
  const [moment, setMoment] = useState<MealMoment>(mealDrawerMoment || 'almuerzo');
  const [selectedFoodId, setSelectedFoodId] = useState<string>('usda-171477-pechuga-pollo-asada');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<FoodCategory | 'all'>('all');
  const [isSearching, setIsSearching] = useState(false);
  const [customFoodTitle, setCustomFoodTitle] = useState('');
  const [quantity, setQuantity] = useState<number>(200);
  const [unit, setUnit] = useState('g');
  const [verified, setVerified] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Sync state when drawer is opened with specific moment or date
  useEffect(() => {
    if (isMealDrawerOpen) {
      if (mealDrawerMoment) {
        setMoment(mealDrawerMoment);
      }
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const baseDate = selectedDate || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      setDateTime(`${baseDate}T${timeStr}`);
    }
  }, [isMealDrawerOpen, mealDrawerMoment, selectedDate]);

  // Active food item resolved from the verified immutable catalog
  const selectedFood = useMemo(() => {
    return NUTRITION_CATALOG.find(f => f.id === selectedFoodId);
  }, [selectedFoodId]);

  // Real-time catalog search filtered by query and category
  const searchResults = useMemo(() => {
    return searchFoods(searchQuery, {
      category: selectedCategory !== 'all' ? selectedCategory : undefined,
      limit: 12,
    });
  }, [searchQuery, selectedCategory]);

  // Pure, non-heuristic mathematical macro calculation
  const macros = useMemo(() => {
    const q = Number(quantity);
    if (!selectedFood || isNaN(q) || q <= 0) {
      return {
        calories: 0,
        protein: 0,
        carbs: 0,
        fats: 0,
        fiber: 0,
      };
    }
    const rawBreakdown = calculateNutrients(selectedFood, q);
    return roundNutrients(rawBreakdown, 1);
  }, [selectedFood, quantity]);

  if (!isMealDrawerOpen) return null;

  const handleSelectFood = (food: FoodItem) => {
    setSelectedFoodId(food.id);
    setIsSearching(false);
    setSearchQuery('');
    // If the food has common portions, default to the first realistic one, or keep current quantity if reasonable
    if (food.commonPortions && food.commonPortions.length > 0) {
      setQuantity(food.commonPortions[0].grams);
    } else {
      setQuantity(100);
    }
    setUnit('g');
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    const title = selectedFood ? selectedFood.name : customFoodTitle.trim() || 'Alimento';
    const stateLabel = selectedFood ? ` (${selectedFood.state.replace('_', ' ')})` : '';
    const fdcMeta = selectedFood ? ` [USDA FDC ${selectedFood.source.fdcId}]` : '';
    const description = `${quantity}${unit} - ${title}${stateLabel}${fdcMeta}`;

    setTimeout(() => {
      addMealLog({
        dateTime,
        moment,
        title,
        description,
        portion: `${quantity} ${unit}`,
        calories: macros.calories,
        protein: macros.protein,
        carbs: macros.carbs,
        fats: macros.fats,
        source: verified ? 'Manual' : 'Plantilla',
        verified,
        foodId: selectedFood?.id,
        foodFdcId: selectedFood?.source.fdcId,
        grams: unit === 'g' ? quantity : undefined,
        fiber: macros.fiber,
      });
      setIsSaving(false);
      closeMealDrawer();
    }, 400);
  };

  return (
    <div className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-xs z-50 flex justify-end animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-surface-container-lowest h-full shadow-2xl flex flex-col justify-between overflow-y-auto animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="p-space-lg bg-surface-container-low/50 flex items-start justify-between border-b border-surface-container/50">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-primary" />
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold tracking-tight">
                Nuevo Registro de Alimento
              </h2>
            </div>
            <p className="font-label-md text-label-md text-on-surface-variant flex items-center gap-1.5">
              <span>Catálogo USDA FoodData Central &amp; Motor Matemático VigorCore</span>
            </p>
          </div>
          <button
            onClick={closeMealDrawer}
            className="p-1 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
            type="button"
            aria-label="Cerrar modal"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-space-lg flex flex-col gap-space-md flex-1">
          {/* Fecha y Hora */}
          <div className="flex flex-col gap-space-xs">
            <label className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
              Fecha &amp; Hora exacta
            </label>
            <input
              type="datetime-local"
              value={dateTime}
              onChange={e => setDateTime(e.target.value)}
              className="w-full bg-surface-container-low px-3 py-2 rounded-lg text-body-md font-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all font-code-data border border-surface-container"
              required
            />
          </div>

          {/* Momento del Día */}
          <div className="flex flex-col gap-space-xs">
            <label className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
              Momento del día
            </label>
            <div className="grid grid-cols-5 gap-1.5">
              {(['desayuno', 'almuerzo', 'merienda', 'cena', 'snack'] as MealMoment[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMoment(m)}
                  className={`py-1.5 px-1 rounded-lg text-label-md font-label-md font-medium text-center capitalize transition-colors cursor-pointer ${
                    moment === m
                      ? 'bg-primary text-on-primary shadow-sm font-semibold'
                      : 'bg-surface-container-low hover:bg-surface-container text-on-surface-variant'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Selector de Alimentos del Catálogo Oficial */}
          <div className="flex flex-col gap-space-xs">
            <div className="flex items-center justify-between">
              <label className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                Alimento Verificado (Catálogo USDA)
              </label>
              {selectedFood && !isSearching && (
                <button
                  type="button"
                  onClick={() => setIsSearching(true)}
                  className="text-primary hover:underline font-label-sm text-label-sm font-medium flex items-center gap-1 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-sm">search</span>
                  Cambiar alimento
                </button>
              )}
            </div>

            {/* Selected Food Card or Search View */}
            {selectedFood && !isSearching ? (
              <div className="p-3 bg-surface-container-low rounded-xl border border-surface-container flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="font-title-sm text-on-surface font-semibold leading-tight">
                      {selectedFood.name}
                    </span>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">
                      {CATEGORY_LABELS[selectedFood.category] || selectedFood.category}
                    </span>
                  </div>
                  <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20 capitalize">
                    {selectedFood.state.replace('_', ' ')}
                  </span>
                </div>

                {/* Badges de Trazabilidad */}
                <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-surface-container/60 text-[11px] text-on-surface-variant">
                  <span className="inline-flex items-center gap-1 font-code-data bg-surface-container px-2 py-0.5 rounded">
                    <span className="material-symbols-outlined text-[12px] text-secondary">verified</span>
                    FDC ID: {selectedFood.source.fdcId}
                  </span>
                  <span className="bg-surface-container px-2 py-0.5 rounded">
                    {selectedFood.source.dataset}
                  </span>
                  <span className="text-on-surface-variant/70 italic truncate max-w-[200px]" title={selectedFood.source.foodDescriptionEn}>
                    {selectedFood.source.foodDescriptionEn}
                  </span>
                </div>

                {/* Per 100g Reference values */}
                <div className="text-[11px] font-code-data text-on-surface-variant/80 bg-surface-container-lowest/60 p-2 rounded-lg">
                  Ref. 100g: <strong>{selectedFood.caloriesPer100g} kcal</strong> • P: {selectedFood.proteinPer100g}g • C: {selectedFood.carbsPer100g}g • G: {selectedFood.fatsPer100g}g • Fibra: {selectedFood.fiberPer100g}g
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 bg-surface-container-low p-3 rounded-xl border border-surface-container">
                {/* Search Input */}
                <div className="relative">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Buscar alimento (ej. pechuga, huevo, arroz, avena, papa...)"
                    className="w-full pl-9 pr-8 py-2 bg-surface-container-lowest rounded-lg text-body-md font-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all border border-surface-container"
                    autoFocus
                  />
                  <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-primary text-lg">
                    search
                  </span>
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-base">close</span>
                    </button>
                  )}
                </div>

                {/* Quick Category Filters */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs no-scrollbar">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('all')}
                    className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors cursor-pointer ${
                      selectedCategory === 'all'
                        ? 'bg-primary text-on-primary font-semibold'
                        : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    Todos ({NUTRITION_CATALOG.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('carnes_aves')}
                    className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors cursor-pointer ${
                      selectedCategory === 'carnes_aves'
                        ? 'bg-primary text-on-primary font-semibold'
                        : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    Carnes &amp; Aves
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('huevos')}
                    className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors cursor-pointer ${
                      selectedCategory === 'huevos'
                        ? 'bg-primary text-on-primary font-semibold'
                        : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    Huevos
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('cereales_granos')}
                    className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors cursor-pointer ${
                      selectedCategory === 'cereales_granos'
                        ? 'bg-primary text-on-primary font-semibold'
                        : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    Cereales
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('tuberculos_raices')}
                    className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors cursor-pointer ${
                      selectedCategory === 'tuberculos_raices'
                        ? 'bg-primary text-on-primary font-semibold'
                        : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    Tubérculos
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('verduras_hortalizas')}
                    className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors cursor-pointer ${
                      selectedCategory === 'verduras_hortalizas'
                        ? 'bg-primary text-on-primary font-semibold'
                        : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    Verduras
                  </button>
                </div>

                {/* Search Results List */}
                <div className="max-h-60 overflow-y-auto flex flex-col gap-1.5 pr-1">
                  {searchResults.length === 0 ? (
                    <div className="p-4 text-center text-on-surface-variant font-label-md">
                      No se encontraron alimentos en el catálogo oficial para &quot;{searchQuery}&quot;.
                    </div>
                  ) : (
                    searchResults.map(food => (
                      <button
                        key={food.id}
                        type="button"
                        onClick={() => handleSelectFood(food)}
                        className={`p-2.5 rounded-lg text-left transition-all border flex flex-col gap-1 cursor-pointer ${
                          selectedFoodId === food.id
                            ? 'bg-primary/5 border-primary/30 shadow-xs'
                            : 'bg-surface-container-lowest hover:bg-surface-container border-surface-container/60'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-label-md text-label-md font-semibold text-on-surface">
                            {food.name}
                          </span>
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-container text-on-surface-variant capitalize shrink-0">
                            {food.state.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-code-data text-on-surface-variant">
                          <span>
                            {food.caloriesPer100g} kcal • {food.proteinPer100g}g P • {food.carbsPer100g}g C • {food.fatsPer100g}g G / 100g
                          </span>
                          <span className="text-secondary font-medium">FDC #{food.source.fdcId}</span>
                        </div>
                      </button>
                    ))
                  )}
                </div>

                {selectedFood && (
                  <button
                    type="button"
                    onClick={() => setIsSearching(false)}
                    className="mt-1 py-1 text-center font-label-sm text-on-surface-variant hover:text-on-surface cursor-pointer"
                  >
                    Mantener &quot;{selectedFood.name}&quot;
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Cantidad y Unidad */}
          <div className="grid grid-cols-3 gap-space-sm">
            <div className="col-span-2 flex flex-col gap-space-xs">
              <label className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                Cantidad consumida
              </label>
              <div className="relative">
                <input
                  type="number"
                  step="1"
                  min="1"
                  max="5000"
                  value={quantity || ''}
                  onChange={e => {
                    const val = Number(e.target.value);
                    setQuantity(val >= 0 ? val : 0);
                  }}
                  className="w-full px-3 py-2 bg-surface-container-low rounded-lg text-body-md font-body-md font-code-data text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all border border-surface-container"
                  required
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant font-label-sm text-label-sm">
                  peso neto
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-space-xs">
              <label className="font-label-sm text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                Unidad
              </label>
              <select
                value={unit}
                onChange={e => setUnit(e.target.value)}
                className="w-full bg-surface-container-low px-3 py-2 rounded-lg text-body-md font-body-md text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/20 border border-surface-container"
              >
                <option value="g">g (gramos)</option>
                <option value="ml">ml (mililitros)</option>
                <option value="unid">unid</option>
                <option value="porcion">porción</option>
              </select>
            </div>
          </div>

          {/* Porciones Habituales Sugeridas por el Catálogo USDA */}
          {selectedFood?.commonPortions && selectedFood.commonPortions.length > 0 && (
            <div className="flex flex-col gap-1.5 -mt-1">
              <span className="font-label-xs text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                Porciones sugeridas ({selectedFood.name}):
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {selectedFood.commonPortions.map(p => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => {
                      setQuantity(p.grams);
                      setUnit('g');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer border ${
                      quantity === p.grams && unit === 'g'
                        ? 'bg-primary text-on-primary border-primary shadow-xs'
                        : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container border-surface-container'
                    }`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Checkbox Báscula */}
          <label className="flex items-center gap-space-sm p-3 bg-surface-container-low rounded-lg cursor-pointer hover:bg-surface-container transition-colors">
            <input
              type="checkbox"
              checked={verified}
              onChange={e => setVerified(e.target.checked)}
              className="w-4 h-4 rounded text-primary focus:ring-primary/20 accent-primary"
            />
            <div className="flex flex-col">
              <span className="font-label-md text-label-md font-semibold text-on-surface">
                Dato verificado / Pesaje exacto en báscula
              </span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">
                Habilita el badge de alta fiabilidad métrica
              </span>
            </div>
          </label>

          {/* Live Calculation Cards con Motor Matemático */}
          <div className="p-space-md bg-surface-container-low/70 rounded-xl flex flex-col gap-space-sm border border-surface-container">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm font-bold uppercase tracking-wider text-on-surface-variant">
                Cálculo en vivo (Motor Matemático Puro)
              </span>
              <span className="font-label-sm text-label-sm text-primary font-semibold flex items-center gap-1">
                <span className="material-symbols-outlined text-xs">calculate</span> Precisión USDA
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="bg-surface-container-lowest p-2 rounded-lg shadow-xs">
                <span className="font-label-sm text-label-sm text-on-surface-variant block">Calorías</span>
                <span className="font-metric-md text-headline-sm font-bold text-on-surface">{macros.calories}</span>
                <span className="text-[10px] text-on-surface-variant block">kcal</span>
              </div>
              <div className="bg-surface-container-lowest p-2 rounded-lg shadow-xs">
                <span className="font-label-sm text-label-sm text-on-surface-variant block">Proteína</span>
                <span className="font-metric-md text-headline-sm font-bold text-primary">{macros.protein}</span>
                <span className="text-[10px] text-on-surface-variant block">g</span>
              </div>
              <div className="bg-surface-container-lowest p-2 rounded-lg shadow-xs">
                <span className="font-label-sm text-label-sm text-on-surface-variant block">Carbos</span>
                <span className="font-metric-md text-headline-sm font-bold text-on-surface">{macros.carbs}</span>
                <span className="text-[10px] text-on-surface-variant block">g</span>
              </div>
              <div className="bg-surface-container-lowest p-2 rounded-lg shadow-xs">
                <span className="font-label-sm text-label-sm text-on-surface-variant block">Grasas</span>
                <span className="font-metric-md text-headline-sm font-bold text-on-surface">{macros.fats}</span>
                <span className="text-[10px] text-on-surface-variant block">g</span>
              </div>
            </div>

            {/* Fila sutil de Fibra Dietética */}
            {macros.fiber > 0 && (
              <div className="flex items-center justify-between px-2 pt-1 text-xs text-on-surface-variant border-t border-surface-container/40">
                <span>Fibra dietética aportada:</span>
                <span className="font-code-data font-semibold text-on-surface">{macros.fiber} g</span>
              </div>
            )}
          </div>

          <div className="p-3 bg-surface-container-high/60 rounded-lg flex items-start gap-2.5">
            <span className="material-symbols-outlined text-primary text-lg shrink-0 mt-0.5">info</span>
            <p className="font-label-sm text-label-sm text-on-surface-variant">
              Los macronutrientes se calculan directamente a partir de las especificaciones analíticas de USDA FoodData Central y se sincronizan en <strong>Cloud Firestore</strong>.
            </p>
          </div>

          {/* Footer Actions */}
          <div className="pt-4 flex items-center justify-end gap-space-sm border-t border-surface-container/50">
            <button
              type="button"
              onClick={closeMealDrawer}
              className="px-space-md py-2 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md font-medium transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving || !quantity || quantity <= 0}
              className="px-space-md py-2 rounded-lg bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold shadow-md flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <>
                  <span className="material-symbols-outlined text-base animate-spin">sync</span>
                  <span>Guardando...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-base">cloud_upload</span>
                  <span>Guardar Registro</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
