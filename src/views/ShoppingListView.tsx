import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { GroceryDepartment, GroceryItem } from '../types';
import { EditGroceryModal } from '../components/modals/EditGroceryModal';
import { getWeekStartEnd } from '../services/dateUtils';

export const ShoppingListView: React.FC = () => {
  const {
    groceries,
    toggleGroceryStatus,
    addGrocery,
    editGrocery,
    resetGroceryToPlan,
    deleteGrocery,
    clearCompletedGroceries,
    syncMealPlanToGroceries,
    currentMealPlan,
    activeWeekStart,
    navigate,
    showToast,
  } = useApp();

  const [activeFilter, setActiveFilter] = useState<'all' | 'pending' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState<string>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GroceryItem | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const weekRange = useMemo(() => getWeekStartEnd(activeWeekStart), [activeWeekStart]);

  // Filter items
  const filteredGroceries = useMemo(() => {
    return groceries.filter(item => {
      const matchesFilter =
        activeFilter === 'all' || item.status === activeFilter;

      const matchesDept =
        selectedDepartment === 'all' || item.department === selectedDepartment;

      const matchesSearch =
        searchQuery === '' ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.notes && item.notes.toLowerCase().includes(searchQuery.toLowerCase()));

      return matchesFilter && matchesDept && matchesSearch;
    });
  }, [groceries, activeFilter, selectedDepartment, searchQuery]);

  const totalCount = groceries.length;
  const completedCount = groceries.filter(i => i.status === 'completed').length;
  const pendingCount = totalCount - completedCount;
  const completionPercentage = totalCount ? Math.round((completedCount / totalCount) * 100) : 0;
  const planItemsCount = groceries.filter(i => i.origin === 'plan').length;
  const manualItemsCount = groceries.filter(i => i.origin === 'manual').length;

  const departmentMeta: Record<
    GroceryDepartment,
    { title: string; icon: string; subtitle: string }
  > = {
    carnes: {
      title: 'Carnes y Pescados',
      icon: 'set_meal',
      subtitle: 'Macro foco: Proteína de alto VB',
    },
    huevos: {
      title: 'Huevos y Lácteos',
      icon: 'egg',
      subtitle: 'Biodisponibilidad y Calcio',
    },
    verduras: {
      title: 'Verduras y Frutas',
      icon: 'psychiatry',
      subtitle: 'Micronutrientes, Fibra & Antioxidantes',
    },
    carbohidratos: {
      title: 'Carbohidratos y Cereales',
      icon: 'grain',
      subtitle: 'Recarga glucogénica • Complejos',
    },
    grasas: {
      title: 'Grasas y Suplementos',
      icon: 'medication',
      subtitle: 'Metabolismo hormonal & Recuperación',
    },
  };

  const departmentsList: GroceryDepartment[] = ['carnes', 'huevos', 'verduras', 'carbohidratos', 'grasas'];

  const handleOpenAddModal = () => {
    setEditingItem(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (item: GroceryItem) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleSaveModal = (
    name: string,
    quantity: number,
    unit: string,
    department: GroceryDepartment,
    notes?: string
  ) => {
    if (editingItem) {
      editGrocery(editingItem.id, name, quantity, unit, department, notes);
    } else {
      addGrocery({
        name,
        quantity,
        unit,
        department,
        notes,
        origin: 'manual',
        recipeSource: 'Añadido manualmente a la lista',
      });
    }
  };

  const handleShare = () => {
    let text = `🛒 VIGORCORE - LISTA DE COMPRAS (${weekRange.weekStart} al ${weekRange.weekEnd})\n\n`;
    departmentsList.forEach(dept => {
      const items = groceries.filter(g => g.department === dept);
      if (items.length > 0) {
        text += `[${departmentMeta[dept].title.toUpperCase()}]\n`;
        items.forEach(item => {
          const check = item.status === 'completed' ? '✅' : '⬜';
          const origin = item.origin === 'manual' ? '(Manual)' : '';
          text += `${check} ${item.name}: ${item.quantity} ${item.unit} ${origin}\n`;
        });
        text += '\n';
      }
    });

    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      showToast('Lista de compras copiada al portapapeles con formato estructurado', 'success');
    } else {
      showToast('No fue posible acceder al portapapeles', 'warning');
    }
  };

  const handleExportPDF = () => {
    handleShare();
    showToast('Lista formateada y lista para imprimir o compartir');
  };

  const handleSyncMenu = async () => {
    setIsSyncing(true);
    try {
      await syncMealPlanToGroceries(currentMealPlan);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="p-4 sm:p-gutter-desktop flex flex-col gap-space-lg max-w-[1440px] mx-auto w-full pb-36 animate-in fade-in duration-150">
      {/* Top Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md">
        <div className="flex flex-col">
          <div className="flex items-center gap-space-xs font-code-data text-code-data text-primary uppercase tracking-wider">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span>Sincronización Idempotente Activa • Menú Semanal</span>
          </div>
          <div className="flex items-baseline gap-space-sm mt-0.5 flex-wrap">
            <h1 className="font-headline-lg text-headline-lg text-on-surface font-semibold tracking-tight">
              Lista de Compras Semanal
            </h1>
            <span className="font-label-md text-label-md px-space-xs py-0.5 bg-surface-container-high text-on-surface-variant rounded font-medium tabular-nums">
              {weekRange.weekStart} · {weekRange.weekEnd}
            </span>
            <span className="font-code-data text-code-data text-on-surface-variant">
              ({planItemsCount} del menú · {manualItemsCount} manuales)
            </span>
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant mt-0.5">
            Cantidades netas consolidadas matemáticamente a partir de las recetas del menú semanal.
          </p>
        </div>

        <div className="flex items-center gap-space-sm shrink-0 flex-wrap">
          <button
            onClick={handleSyncMenu}
            disabled={isSyncing}
            className="flex items-center gap-space-xs px-space-md h-9 bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md rounded-lg transition-colors shadow-xs border border-surface-container/60 cursor-pointer disabled:opacity-60"
            type="button"
          >
            <span className={`material-symbols-outlined text-base text-primary ${isSyncing ? 'animate-spin' : ''}`}>
              sync
            </span>
            <span>{isSyncing ? 'Sincronizando...' : 'Sincronizar con Menú'}</span>
          </button>
          <button
            onClick={handleOpenAddModal}
            className="flex items-center gap-space-xs px-space-md h-9 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg transition-colors shadow-xs cursor-pointer font-medium"
            type="button"
          >
            <span className="material-symbols-outlined text-base">add</span>
            <span>Añadir Insumo</span>
          </button>
        </div>
      </div>

      {/* Bento KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
              Total Insumos
            </span>
            <span className="material-symbols-outlined text-lg text-secondary">inventory_2</span>
          </div>
          <div className="my-space-xs flex items-baseline gap-space-xs">
            <span className="font-metric-xl text-metric-xl text-on-surface tabular-nums">{totalCount}</span>
            <span className="font-label-md text-label-md text-on-surface-variant font-medium">artículos</span>
          </div>
          <div className="flex items-center gap-space-xs font-code-data text-code-data text-on-surface-variant">
            <span className="w-2 h-2 rounded-full bg-tertiary" />
            <span>Distribuidos en 5 departamentos</span>
          </div>
        </div>

        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
              Comprados
            </span>
            <span className="font-label-sm text-label-sm bg-primary-fixed text-on-primary-fixed px-space-xs py-0.5 rounded font-semibold tabular-nums">
              {completionPercentage}%
            </span>
          </div>
          <div className="my-space-xs flex items-baseline gap-space-xs">
            <span className="font-metric-xl text-metric-xl text-primary tabular-nums">{completedCount}</span>
            <span className="font-label-md text-label-md text-on-surface-variant font-medium">
              de {totalCount} listos
            </span>
          </div>
          <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-primary h-full rounded-full transition-all duration-300"
              style={{ width: `${completionPercentage}%` }}
            />
          </div>
        </div>

        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
              Pendientes
            </span>
            <span className="material-symbols-outlined text-lg text-outline">pending_actions</span>
          </div>
          <div className="my-space-xs flex items-baseline gap-space-xs">
            <span className="font-metric-xl text-metric-xl text-on-surface tabular-nums">{pendingCount}</span>
            <span className="font-label-md text-label-md text-on-surface-variant font-medium">por adquirir</span>
          </div>
          <div className="flex items-center gap-space-xs font-code-data text-code-data text-on-surface-variant">
            <span className="material-symbols-outlined text-xs text-error">priority_high</span>
            <span>Esenciales para comidas Jue - Dom</span>
          </div>
        </div>

        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
              Inversión Estimada
            </span>
            <span className="material-symbols-outlined text-lg text-primary">payments</span>
          </div>
          <div className="my-space-xs flex items-baseline gap-space-xs">
            <span className="font-metric-xl text-metric-xl text-on-surface tabular-nums">$245.800</span>
            <span className="font-label-md text-label-md text-on-surface-variant font-medium">COP</span>
          </div>
          <div className="flex items-center justify-between font-code-data text-code-data text-on-surface-variant text-[11px]">
            <span>Ejecutado: $162.000</span>
            <span className="text-primary font-medium">Restante: $83.800</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-surface-container-lowest p-space-sm rounded-xl shadow-xs border border-surface-container/50 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-space-sm">
        {/* Status Tabs */}
        <div className="flex items-center bg-surface-container-low p-1 rounded-lg gap-1 shrink-0">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-space-md py-1.5 rounded-md font-label-md text-label-md transition-all ${
              activeFilter === 'all'
                ? 'font-semibold bg-surface-container-lowest text-on-surface shadow-xs'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
            type="button"
          >
            Todos <span className="ml-1 text-on-surface-variant font-normal tabular-nums">{totalCount}</span>
          </button>
          <button
            onClick={() => setActiveFilter('pending')}
            className={`px-space-md py-1.5 rounded-md font-label-md text-label-md transition-all ${
              activeFilter === 'pending'
                ? 'font-semibold bg-surface-container-lowest text-on-surface shadow-xs'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
            type="button"
          >
            Pendientes{' '}
            <span className="ml-1 px-1.5 py-0.2 bg-surface-container-highest text-on-surface rounded-full text-[10px] tabular-nums">
              {pendingCount}
            </span>
          </button>
          <button
            onClick={() => setActiveFilter('completed')}
            className={`px-space-md py-1.5 rounded-md font-label-md text-label-md transition-all ${
              activeFilter === 'completed'
                ? 'font-semibold bg-surface-container-lowest text-on-surface shadow-xs'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
            type="button"
          >
            Comprados{' '}
            <span className="ml-1 text-on-surface-variant font-normal tabular-nums">{completedCount}</span>
          </button>
        </div>

        {/* Search & Department Dropdown */}
        <div className="flex items-center gap-space-sm flex-1 max-w-xl">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-space-sm top-2 text-lg text-outline">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Buscar por ingrediente (ej. Pollo, Aguacate)..."
              className="w-full h-9 pl-9 pr-space-sm bg-surface-container-low text-on-surface font-body-md text-body-md rounded-lg focus:outline-none focus:bg-surface-container-lowest border border-surface-container/40 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant/60 hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            )}
          </div>

          <div className="relative shrink-0">
            <select
              value={selectedDepartment}
              onChange={e => setSelectedDepartment(e.target.value)}
              className="h-9 px-space-md pr-8 bg-surface-container-low text-on-surface font-label-md text-label-md rounded-lg appearance-none cursor-pointer focus:outline-none border border-surface-container/40"
            >
              <option value="all">Todos los departamentos</option>
              <option value="carnes">Carnes y Pescados</option>
              <option value="huevos">Huevos y Lácteos</option>
              <option value="verduras">Verduras y Frutas</option>
              <option value="carbohidratos">Carbohidratos y Cereales</option>
              <option value="grasas">Grasas y Suplementos</option>
            </select>
            <span className="material-symbols-outlined absolute right-2.5 top-2.5 text-base text-outline pointer-events-none">
              unfold_more
            </span>
          </div>
        </div>
      </div>

      {/* Grouped Department Sections */}
      <div className="flex flex-col gap-space-lg">
        {departmentsList.map(dept => {
          const deptItems = filteredGroceries.filter(i => i.department === dept);
          if (deptItems.length === 0 && selectedDepartment !== 'all') return null;

          const meta = departmentMeta[dept];

          return (
            <div key={dept} className="flex flex-col gap-space-xs">
              <div className="flex items-center justify-between px-space-xs py-space-xs">
                <div className="flex items-center gap-space-sm">
                  <span className="material-symbols-outlined text-primary text-xl">{meta.icon}</span>
                  <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-tight">
                    {meta.title}
                  </h2>
                  <span className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-high px-space-xs py-0.5 rounded-full font-medium">
                    {deptItems.length} insumos
                  </span>
                </div>
                <span className="font-code-data text-code-data text-on-surface-variant hidden sm:inline">
                  {meta.subtitle}
                </span>
              </div>

              <div className="bg-surface-container-lowest rounded-xl shadow-xs border border-surface-container/50 overflow-hidden flex flex-col divide-y divide-surface-container/40">
                {deptItems.length === 0 ? (
                  <div className="p-space-md text-center text-on-surface-variant font-label-md text-label-md">
                    No hay insumos pendientes en este departamento.
                  </div>
                ) : (
                  deptItems.map(item => {
                    const isCompleted = item.status === 'completed';
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center justify-between p-space-md hover:bg-surface-container-low/60 transition-colors group ${
                          isCompleted ? 'opacity-75' : ''
                        }`}
                      >
                        <div className="flex items-center gap-space-md min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={isCompleted}
                            onChange={() => toggleGroceryStatus(item.id)}
                            className="w-5 h-5 rounded cursor-pointer accent-primary shrink-0"
                          />
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-space-sm flex-wrap">
                              <span
                                className={`font-body-lg text-body-lg truncate font-medium ${
                                  isCompleted
                                    ? 'line-through text-on-surface-variant'
                                    : 'text-on-surface'
                                }`}
                              >
                                {item.name}
                              </span>
                              <span
                                className={`px-space-xs py-0.5 font-code-data text-code-data font-bold rounded ${
                                  isCompleted
                                    ? 'bg-surface-container-high text-on-surface-variant'
                                    : 'bg-primary-fixed text-on-primary-fixed'
                                }`}
                              >
                                {item.quantity} {item.unit}
                              </span>

                              {/* Origin and State Badges */}
                              {item.origin === 'manual' ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-code-data font-semibold bg-tertiary-fixed text-on-tertiary-fixed">
                                  Manual
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-code-data font-medium bg-surface-container-high text-on-surface-variant">
                                  Menú Semanal
                                </span>
                              )}

                              {item.preparationState && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-code-data bg-surface-container text-on-surface-variant uppercase">
                                  {item.preparationState}
                                </span>
                              )}
                            </div>

                            {/* Details, Origin, Warnings & Notes */}
                            <div className="flex flex-col gap-1 mt-1 text-on-surface-variant">
                              {(item.recipeSource || item.nutritionInfo || item.notes) && (
                                <div className="flex items-center gap-space-sm text-on-surface-variant flex-wrap text-xs">
                                  {item.recipeSource && (
                                    <span className="font-code-data text-code-data flex items-center gap-1 bg-surface-container-low px-1.5 py-0.5 rounded border border-surface-container/40">
                                      <span className="material-symbols-outlined text-xs text-primary">
                                        {isCompleted ? 'done' : 'calculate'}
                                      </span>
                                      <span>{item.recipeSource}</span>
                                    </span>
                                  )}
                                  {item.nutritionInfo && (
                                    <span className="font-code-data text-code-data text-secondary">
                                      {item.nutritionInfo}
                                    </span>
                                  )}
                                  {item.notes && (
                                    <span className="font-code-data text-code-data text-on-surface-variant/80 flex items-center gap-1">
                                      <span className="material-symbols-outlined text-xs">edit_note</span>
                                      <span>{item.notes}</span>
                                    </span>
                                  )}
                                </div>
                              )}

                              {item.warning && (
                                <div className="flex items-center gap-1 text-[11px] font-code-data text-amber-700 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 max-w-fit">
                                  <span className="material-symbols-outlined text-xs text-amber-600">info</span>
                                  <span>{item.warning}</span>
                                </div>
                              )}

                              {item.isCustomized && (
                                <div className="flex items-center gap-1 text-[11px] font-code-data text-primary bg-primary-fixed/20 px-2 py-0.5 rounded border border-primary/30 max-w-fit flex-wrap">
                                  <span className="material-symbols-outlined text-xs">tune</span>
                                  <span>
                                    Cantidad ajustada por ti{' '}
                                    {item.calculatedQuantity !== undefined
                                      ? `(Menú calculó: ${item.calculatedQuantity} ${item.unit})`
                                      : ''}
                                  </span>
                                  {item.calculatedQuantity !== undefined && !isCompleted && (
                                    <button
                                      type="button"
                                      onClick={() => resetGroceryToPlan(item.id)}
                                      className="underline hover:text-primary font-semibold ml-1 cursor-pointer"
                                      title="Restablecer a la cantidad calculada por el menú"
                                    >
                                      Restablecer al menú
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-space-xs opacity-90 group-hover:opacity-100 transition-opacity">
                          {!isCompleted && (
                            <button
                              onClick={() => {
                                showToast(`Abriendo sustitutos para: ${item.name}`);
                                navigate('sustituciones');
                              }}
                              className="px-space-xs py-1 text-on-surface-variant hover:text-primary hover:bg-surface-container rounded font-label-sm text-label-sm flex items-center gap-1 transition-colors cursor-pointer"
                              title="Sustituir ingrediente"
                              type="button"
                            >
                              <span className="material-symbols-outlined text-base">swap_horiz</span>
                              <span className="hidden sm:inline">Sustituir</span>
                            </button>
                          )}
                          <button
                            onClick={() => handleOpenEditModal(item)}
                            className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded transition-colors cursor-pointer"
                            title="Editar cantidad"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-base">edit</span>
                          </button>
                          <button
                            onClick={() => deleteGrocery(item.id)}
                            className="p-1.5 text-on-surface-variant hover:text-error hover:bg-surface-container rounded transition-colors cursor-pointer"
                            title="Eliminar"
                            type="button"
                          >
                            <span className="material-symbols-outlined text-base">delete</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Floating Bottom Command Toolbar */}
      <div className="fixed bottom-4 left-4 sm:left-auto sm:right-6 lg:left-80 right-4 z-30">
        <div className="bg-surface-container-lowest/95 backdrop-blur-md rounded-xl p-space-xs shadow-xl border border-surface-container/60 flex flex-wrap items-center justify-between gap-space-sm max-w-4xl mx-auto">
          <div className="flex items-center gap-space-xs pl-space-xs">
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-primary-fixed text-on-primary-fixed">
              <span className="material-symbols-outlined text-base">shopping_cart_checkout</span>
            </span>
            <div className="flex flex-col">
              <span className="font-label-md text-label-md text-on-surface font-semibold">
                {completedCount} de {totalCount} en el carrito
              </span>
              <span className="font-code-data text-code-data text-on-surface-variant">
                Sincronizado con Bogotá DC
              </span>
            </div>
          </div>

          <div className="flex items-center gap-space-xs flex-wrap">
            <button
              onClick={clearCompletedGroceries}
              className="flex items-center gap-1 px-space-sm py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md rounded-lg transition-colors cursor-pointer"
              type="button"
            >
              <span className="material-symbols-outlined text-base text-outline">playlist_remove</span>
              <span>Limpiar comprados</span>
            </button>
            <button
              onClick={handleExportPDF}
              className="flex items-center gap-1 px-space-sm py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md rounded-lg transition-colors cursor-pointer"
              type="button"
            >
              <span className="material-symbols-outlined text-base text-outline">picture_as_pdf</span>
              <span>Exportar PDF</span>
            </button>
            <button
              onClick={handleShare}
              className="flex items-center gap-1 px-space-sm py-1.5 bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md rounded-lg transition-colors cursor-pointer"
              type="button"
            >
              <span className="material-symbols-outlined text-base text-outline">share</span>
              <span>Compartir</span>
            </button>
            <button
              onClick={handleSyncMenu}
              disabled={isSyncing}
              className="flex items-center gap-1 px-space-md py-1.5 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg transition-colors shadow-xs cursor-pointer font-medium disabled:opacity-60"
              type="button"
            >
              <span className={`material-symbols-outlined text-base ${isSyncing ? 'animate-spin' : ''}`}>
                auto_fix_high
              </span>
              <span>{isSyncing ? 'Sincronizando...' : 'Regenerar desde Menú'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Edit / Add Modal */}
      <EditGroceryModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveModal}
        initialItem={editingItem}
      />
    </div>
  );
};
