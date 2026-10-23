import React, { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { MealMoment } from '../../types';
import { Recipe } from '../../types/nutrition';
import { formatSpanishDate } from '../../services/dateUtils';

const MOMENT_LABELS: Record<MealMoment, string> = {
  desayuno: 'Desayuno',
  almuerzo: 'Almuerzo',
  merienda: 'Merienda',
  cena: 'Cena',
  snack: 'Snack / Refrigerio',
};

export const AssignRecipeModal: React.FC = () => {
  const {
    isAssignModalOpen,
    assignModalSlot,
    closeAssignModal,
    recipes,
    assignRecipeToSlot,
    removeSlotFromPlan,
    openRecipeModal,
    showToast,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [momentFilter, setMomentFilter] = useState<string>('all');
  const [servings, setServings] = useState<number>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Set default moment filter to slot moment when modal opens
  React.useEffect(() => {
    if (isAssignModalOpen && assignModalSlot) {
      setMomentFilter(assignModalSlot.moment);
      setSearchQuery('');
      setServings(1);
      setIsSubmitting(false);
    }
  }, [isAssignModalOpen, assignModalSlot]);

  const filteredRecipes = useMemo(() => {
    return recipes.filter(r => {
      const matchMoment = momentFilter === 'all' || r.suggestedMoment === momentFilter;
      const q = searchQuery.toLowerCase().trim();
      const matchQuery =
        !q ||
        r.name.toLowerCase().includes(q) ||
        (r.description && r.description.toLowerCase().includes(q)) ||
        r.ingredients.some(i => i.foodName.toLowerCase().includes(q));

      return matchMoment && matchQuery;
    });
  }, [recipes, momentFilter, searchQuery]);

  if (!isAssignModalOpen || !assignModalSlot) return null;

  const handleSelectRecipe = async (recipe: Recipe) => {
    setIsSubmitting(true);
    try {
      await assignRecipeToSlot(
        assignModalSlot.date,
        assignModalSlot.moment,
        recipe.id,
        servings
      );
      closeAssignModal();
    } catch (err: any) {
      showToast(err?.message || 'Error al asignar la receta', 'warning');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveCurrent = async () => {
    setIsSubmitting(true);
    try {
      await removeSlotFromPlan(assignModalSlot.date, assignModalSlot.moment);
      closeAssignModal();
    } catch (err: any) {
      showToast(err?.message || 'Error al quitar la receta', 'warning');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateNew = () => {
    closeAssignModal();
    openRecipeModal({ initialMoment: assignModalSlot.moment });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="assign-modal-title"
      className="fixed inset-0 z-50 overflow-y-auto bg-scrim/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 md:p-6 animate-in fade-in duration-200"
    >
      <div className="bg-surface-container-lowest text-on-surface rounded-2xl shadow-xl border border-surface-container max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <header className="p-space-lg border-b border-surface-container flex items-center justify-between shrink-0 bg-surface-container-low">
          <div className="flex items-center gap-space-sm">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl">event_available</span>
            </div>
            <div>
              <h2
                id="assign-modal-title"
                className="font-headline-sm text-headline-sm font-semibold text-on-surface"
              >
                Planificar {MOMENT_LABELS[assignModalSlot.moment]}
              </h2>
              <p className="font-label-sm text-label-sm text-on-surface-variant">
                {formatSpanishDate(assignModalSlot.date)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeAssignModal}
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-xl transition-colors cursor-pointer"
            aria-label="Cerrar modal de asignación"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </header>

        {/* Controls Toolbar */}
        <div className="p-4 sm:p-space-md border-b border-surface-container bg-surface-container-lowest flex flex-col sm:flex-row gap-space-sm items-center justify-between">
          {/* Search */}
          <div className="relative w-full sm:w-72">
            <input
              type="text"
              placeholder="Buscar receta en la biblioteca..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-surface-container-low border border-surface-container rounded-xl text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            <span className="material-symbols-outlined text-base text-on-surface-variant absolute left-2.5 top-2.5">
              search
            </span>
          </div>

          {/* Moment Filter Pills */}
          <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
            <button
              type="button"
              onClick={() => setMomentFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                momentFilter === 'all'
                  ? 'bg-primary text-on-primary shadow-xs'
                  : 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant'
              }`}
            >
              Todas
            </button>
            {(['desayuno', 'almuerzo', 'merienda', 'cena', 'snack'] as MealMoment[]).map(m => (
              <button
                key={m}
                type="button"
                onClick={() => setMomentFilter(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                  momentFilter === m
                    ? 'bg-primary text-on-primary shadow-xs'
                    : 'bg-surface-container hover:bg-surface-container-high text-on-surface-variant'
                }`}
              >
                {MOMENT_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {/* Servings Adjuster Bar */}
        <div className="px-space-lg py-2.5 bg-surface-container-low border-b border-surface-container flex items-center justify-between text-xs sm:text-sm">
          <span className="text-on-surface-variant font-medium">
            Porciones a planificar para este horario:
          </span>
          <div className="flex items-center gap-1.5">
            {[1, 1.5, 2, 3].map(val => (
              <button
                key={val}
                type="button"
                onClick={() => setServings(val)}
                className={`px-2.5 py-1 rounded-md font-code-data font-bold text-xs transition-colors cursor-pointer ${
                  servings === val
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container-lowest border border-surface-container text-on-surface hover:bg-surface-container'
                }`}
              >
                {val}x
              </button>
            ))}
          </div>
        </div>

        {/* Recipe Cards List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-space-lg flex flex-col gap-space-sm">
          {filteredRecipes.length === 0 ? (
            <div className="p-space-xl text-center flex flex-col items-center justify-center gap-space-md">
              <div className="w-14 h-14 rounded-2xl bg-surface-container-high text-on-surface-variant flex items-center justify-center">
                <span className="material-symbols-outlined text-3xl">menu_book</span>
              </div>
              <div>
                <p className="font-headline-sm text-base font-semibold text-on-surface">
                  No se encontraron recetas disponibles
                </p>
                <p className="font-body-md text-sm text-on-surface-variant max-w-sm mx-auto mt-1">
                  Crea tu primera receta usando alimentos verificados del catálogo USDA para asignarla a tu menú.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCreateNew}
                className="px-space-lg py-2 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold rounded-xl shadow-xs transition-all flex items-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">add</span>
                <span>Crear Nueva Receta</span>
              </button>
            </div>
          ) : (
            filteredRecipes.map(recipe => {
              const isCurrentlyAssigned = assignModalSlot.currentRecipeId === recipe.id;
              const scaledKcal = Math.round(recipe.totalNutrients.calories * servings);
              const scaledP = Math.round(recipe.totalNutrients.protein * servings * 10) / 10;
              const scaledC = Math.round(recipe.totalNutrients.carbs * servings * 10) / 10;
              const scaledG = Math.round(recipe.totalNutrients.fats * servings * 10) / 10;

              return (
                <div
                  key={recipe.id}
                  className={`p-space-md rounded-xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-md ${
                    isCurrentlyAssigned
                      ? 'bg-primary/5 border-primary/40 shadow-xs'
                      : 'bg-surface-container-low hover:bg-surface-container border-surface-container/60'
                  }`}
                >
                  <div className="flex items-start gap-space-md flex-1 min-w-0">
                    {recipe.imageUrl ? (
                      <img
                        src={recipe.imageUrl}
                        alt={recipe.name}
                        className="w-16 h-16 rounded-xl object-cover shrink-0 bg-surface-container"
                      />
                    ) : (
                      <div className="w-16 h-16 rounded-xl bg-surface-container-high text-primary flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-2xl">restaurant</span>
                      </div>
                    )}

                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-headline-sm text-sm sm:text-base font-semibold text-on-surface truncate">
                          {recipe.name}
                        </h3>
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-surface-container-high text-primary font-code-data">
                          {MOMENT_LABELS[recipe.suggestedMoment]}
                        </span>
                        {isCurrentlyAssigned && (
                          <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-primary text-on-primary">
                            Asignada
                          </span>
                        )}
                      </div>

                      {recipe.description && (
                        <p className="font-body-md text-xs text-on-surface-variant truncate mt-0.5">
                          {recipe.description}
                        </p>
                      )}

                      <div className="flex items-center gap-3 text-xs text-on-surface-variant font-code-data mt-1.5 flex-wrap">
                        <span className="font-bold text-primary">{scaledKcal} kcal</span>
                        <span>Prot: {scaledP}g</span>
                        <span>Carb: {scaledC}g</span>
                        <span>Gras: {scaledG}g</span>
                        <span>· {recipe.prepTimeMinutes || 15} mins</span>
                        <span>· {recipe.ingredients.length} ingredientes</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-space-xs w-full sm:w-auto justify-end shrink-0">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => handleSelectRecipe(recipe)}
                      className="px-space-lg py-2 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-semibold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <span className="material-symbols-outlined text-base">check</span>
                      <span>{isCurrentlyAssigned ? 'Reasignar' : 'Asignar'}</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <footer className="p-space-lg border-t border-surface-container flex items-center justify-between shrink-0 bg-surface-container-low">
          <div>
            {assignModalSlot.currentRecipeId && (
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleRemoveCurrent}
                className="text-error hover:bg-error-container/20 px-space-md py-2 rounded-xl text-label-md font-label-md font-medium transition-colors flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-base">delete</span>
                <span>Desasignar horario</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-space-sm">
            <button
              type="button"
              onClick={handleCreateNew}
              className="px-space-md py-2 bg-surface-container hover:bg-surface-container-high text-on-surface rounded-xl text-label-md font-label-md font-medium transition-colors flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-base">add</span>
              <span>Crear otra receta</span>
            </button>
            <button
              type="button"
              onClick={closeAssignModal}
              className="px-space-md py-2 text-on-surface-variant hover:text-on-surface rounded-xl text-label-md font-label-md font-medium transition-colors cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
