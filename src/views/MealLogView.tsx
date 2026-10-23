import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { MealMoment, MealLogItem } from '../types';

export const MealLogView: React.FC = () => {
  const { mealLogs, openMealDrawer, deleteMealLog, duplicateMealLog, showToast, todaySummary } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMoment, setSelectedMoment] = useState<string>('all');
  const [selectedDateRange, setSelectedDateRange] = useState('semana');
  const [selectedSource, setSelectedSource] = useState('todos');
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);

  // Filtered meal logs
  const filteredLogs = useMemo(() => {
    return mealLogs.filter(item => {
      const matchesSearch =
        searchQuery === '' ||
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.description.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesMoment = selectedMoment === 'all' || item.moment === selectedMoment;
      const matchesSource =
        selectedSource === 'todos' || item.source.toLowerCase() === selectedSource.toLowerCase();

      return matchesSearch && matchesMoment && matchesSource;
    });
  }, [mealLogs, searchQuery, selectedMoment, selectedSource]);

  const totalFiltered = filteredLogs.length;
  const totalPages = Math.ceil(totalFiltered / rowsPerPage) || 1;
  const paginatedLogs = filteredLogs.slice(
    (currentPage - 1) * rowsPerPage,
    currentPage * rowsPerPage
  );

  const handleExport = () => {
    const jsonStr = JSON.stringify(mealLogs, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vigor_registro_comidas_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showToast('Exportación descargada en formato JSON / CSV');
  };

  const handleImport = () => {
    showToast('Importación desde Excel o CSV simulada: 12 filas añadidas');
  };

  return (
    <div className="p-4 sm:p-gutter-desktop max-w-[1440px] mx-auto w-full flex flex-col gap-space-lg animate-in fade-in duration-150">
      {/* Header & Main Actions */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-space-md">
        <div className="flex flex-col gap-space-xs max-w-2xl">
          <div className="flex items-center gap-space-sm flex-wrap">
            <h1 className="font-headline-lg text-headline-lg text-on-surface tracking-tight font-semibold">
              Registro de Comidas
            </h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface-container-high text-primary font-label-sm text-label-sm font-semibold shadow-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              924 registros almacenados
            </span>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-surface-container-low text-on-surface-variant font-label-sm text-label-sm">
              <span className="material-symbols-outlined text-xs text-primary">cloud_done</span>
              Sincronizado: Hoy, 12:45 PM
            </span>
          </div>
          <p className="font-body-md text-body-md text-on-surface-variant">
            Historial granular de alimentos y preparaciones consumidas sincronizado con la base de datos (~900 filas históricas con desglose métrico exacto).
          </p>
        </div>

        <div className="flex items-center gap-space-sm flex-wrap self-start">
          <button
            onClick={handleExport}
            className="inline-flex items-center gap-space-xs px-space-md py-2 bg-surface-container-lowest hover:bg-surface-container-low text-on-surface font-label-md text-label-md rounded-lg font-medium shadow-xs transition-colors cursor-pointer border border-surface-container"
            type="button"
          >
            <span className="material-symbols-outlined text-base text-secondary">file_download</span>
            <span>Exportar</span>
          </button>
          <button
            onClick={handleImport}
            className="inline-flex items-center gap-space-xs px-space-md py-2 bg-surface-container-lowest hover:bg-surface-container-low text-on-surface font-label-md text-label-md rounded-lg font-medium shadow-xs transition-colors cursor-pointer border border-surface-container"
            type="button"
          >
            <span className="material-symbols-outlined text-base text-secondary">upload_file</span>
            <span>Importar Excel / CSV</span>
          </button>
          <button
            onClick={openMealDrawer}
            className="inline-flex items-center gap-space-xs px-space-md py-2 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg font-medium shadow-sm transition-all active:scale-[0.98] cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined text-base">add_circle</span>
            <span>+ Registrar nueva comida</span>
          </button>
        </div>
      </div>

      {/* Daily Summary Telemetry Bento */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-space-md">
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
              Energía Hoy
            </span>
            <span className="material-symbols-outlined text-primary text-lg">local_fire_department</span>
          </div>
          <div className="my-space-xs flex items-baseline gap-1">
            <span className="font-metric-xl text-metric-xl text-on-surface font-bold">
              {todaySummary.calories}
            </span>
            <span className="font-label-md text-label-md text-on-surface-variant">/ 2,400 kcal</span>
          </div>
          <div className="w-full bg-surface-container-low h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${Math.min(100, Math.round((todaySummary.calories / 2400) * 100))}%` }}
            />
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
              Proteínas
            </span>
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-primary-fixed text-on-primary-fixed">
              98% Meta
            </span>
          </div>
          <div className="my-space-xs flex items-baseline gap-1">
            <span className="font-metric-xl text-metric-xl text-on-surface font-bold">
              {todaySummary.protein}
            </span>
            <span className="font-label-md text-label-md text-on-surface-variant">/ 165 g</span>
          </div>
          <div className="w-full bg-surface-container-low h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-primary h-full rounded-full"
              style={{ width: `${Math.min(100, Math.round((todaySummary.protein / 165) * 100))}%` }}
            />
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
              Carbohidratos
            </span>
            <span className="font-label-sm text-label-sm text-on-surface-variant">Complejos</span>
          </div>
          <div className="my-space-xs flex items-baseline gap-1">
            <span className="font-metric-xl text-metric-xl text-on-surface font-bold">
              {todaySummary.carbs}
            </span>
            <span className="font-label-md text-label-md text-on-surface-variant">/ 250 g</span>
          </div>
          <div className="w-full bg-surface-container-low h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-tertiary-container h-full rounded-full"
              style={{ width: `${Math.min(100, Math.round((todaySummary.carbs / 250) * 100))}%` }}
            />
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
              Grasas Saludables
            </span>
            <span className="font-label-sm text-label-sm text-on-surface-variant">Densidad</span>
          </div>
          <div className="my-space-xs flex items-baseline gap-1">
            <span className="font-metric-xl text-metric-xl text-on-surface font-bold">
              {todaySummary.fats}
            </span>
            <span className="font-label-md text-label-md text-on-surface-variant">/ 65 g</span>
          </div>
          <div className="w-full bg-surface-container-low h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-secondary h-full rounded-full"
              style={{ width: `${Math.min(100, Math.round((todaySummary.fats / 65) * 100))}%` }}
            />
          </div>
        </div>
      </div>

      {/* Control, Search & Advanced Filter Toolbar */}
      <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-space-sm">
          <div className="relative flex-1 max-w-lg">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Buscar por ej: pechuga, avena, yogur, salmón..."
              className="w-full pl-10 pr-4 py-2 bg-surface-container-low rounded-lg text-body-md font-body-md text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:bg-surface-container-lowest focus:ring-1 focus:ring-primary/40 border border-surface-container/40 transition-all"
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

          <div className="flex items-center gap-space-xs flex-wrap">
            <div className="relative">
              <select
                value={selectedDateRange}
                onChange={e => setSelectedDateRange(e.target.value)}
                className="appearance-none bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md pl-3 pr-8 py-2 rounded-lg cursor-pointer focus:outline-none border border-surface-container/40 transition-colors"
              >
                <option value="semana">Semana 43 (Octubre 2024)</option>
                <option value="hoy">Hoy, 24 Octubre</option>
                <option value="30d">Últimos 30 días</option>
                <option value="historico">Histórico completo (924)</option>
              </select>
              <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-sm text-on-surface-variant pointer-events-none">
                expand_more
              </span>
            </div>

            <div className="relative">
              <select
                value={selectedSource}
                onChange={e => setSelectedSource(e.target.value)}
                className="appearance-none bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md pl-3 pr-8 py-2 rounded-lg cursor-pointer focus:outline-none border border-surface-container/40 transition-colors"
              >
                <option value="todos">Todos los orígenes</option>
                <option value="manual">Manual verificado</option>
                <option value="plantilla">Plantilla Menú Semanal</option>
                <option value="receta">Receta guardada</option>
              </select>
              <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-sm text-on-surface-variant pointer-events-none">
                expand_more
              </span>
            </div>
          </div>
        </div>

        {/* Moment Chips Row */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pt-space-xs">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            <span className="font-label-sm text-label-sm text-on-surface-variant mr-1 font-semibold">Momento:</span>
            {[
              { id: 'all', label: 'Todos' },
              { id: 'desayuno', label: 'Desayuno' },
              { id: 'almuerzo', label: 'Almuerzo' },
              { id: 'merienda', label: 'Merienda' },
              { id: 'cena', label: 'Cena' },
              { id: 'snack', label: 'Snack' },
            ].map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setSelectedMoment(m.id);
                  setCurrentPage(1);
                }}
                className={`px-3 py-1 rounded-full text-label-md font-label-md font-medium transition-all ${
                  selectedMoment === m.id
                    ? 'bg-primary text-on-primary shadow-xs'
                    : 'bg-surface-container-low hover:bg-surface-container text-on-surface-variant'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-space-xs text-on-surface-variant font-label-sm text-label-sm self-end sm:self-auto">
            <span className="w-2 h-2 rounded-full bg-primary" />
            <span>
              Mostrando <strong>{paginatedLogs.length}</strong> de <strong>{totalFiltered}</strong> registros
            </span>
          </div>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-xs border border-surface-container/50 overflow-hidden flex flex-col">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low/70 text-on-surface-variant font-label-sm text-label-sm uppercase tracking-wider">
                <th className="py-3 px-4 font-semibold" scope="col">Fecha &amp; Hora</th>
                <th className="py-3 px-3 font-semibold" scope="col">Momento</th>
                <th className="py-3 px-4 font-semibold min-w-[220px]" scope="col">Alimento / Preparación</th>
                <th className="py-3 px-3 text-right font-semibold" scope="col">Porción</th>
                <th className="py-3 px-3 text-right font-semibold text-primary" scope="col">Calorías</th>
                <th className="py-3 px-3 text-right font-semibold" scope="col">Proteína</th>
                <th className="py-3 px-3 text-right font-semibold" scope="col">Carbs</th>
                <th className="py-3 px-3 text-right font-semibold" scope="col">Grasas</th>
                <th className="py-3 px-3 text-center font-semibold" scope="col">Origen</th>
                <th className="py-3 px-4 text-center font-semibold" scope="col">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container font-body-md text-body-md text-on-surface">
              {paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-on-surface-variant">
                    No se encontraron registros de comidas coincidentes con los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                paginatedLogs.map(item => (
                  <tr key={item.id} className="hover:bg-surface-container-low/40 transition-colors group">
                    <td className="py-3.5 px-4 font-code-data text-code-data text-on-surface-variant whitespace-nowrap">
                      <span className="font-semibold text-on-surface">{item.dateTime.slice(0, 10)}</span>{' '}
                      <span className="text-on-surface-variant/70">{item.dateTime.slice(11, 16)}</span>
                    </td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-label-sm font-label-sm font-semibold capitalize ${
                          item.moment === 'almuerzo'
                            ? 'bg-surface-container-high text-primary'
                            : item.moment === 'desayuno'
                            ? 'bg-secondary-container text-on-secondary-fixed'
                            : item.moment === 'merienda'
                            ? 'bg-tertiary-fixed text-on-tertiary-fixed-variant'
                            : item.moment === 'cena'
                            ? 'bg-surface-container-highest text-on-surface'
                            : 'bg-surface-container text-on-surface-variant'
                        }`}
                      >
                        {item.moment}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col">
                        <span className="font-semibold text-on-surface group-hover:text-primary transition-colors">
                          {item.title}
                        </span>
                        <span className="text-label-sm font-label-sm text-on-surface-variant line-clamp-1">
                          {item.description}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-right font-code-data text-code-data text-on-surface font-medium whitespace-nowrap">
                      {item.portion}
                    </td>
                    <td className="py-3.5 px-3 text-right font-metric-md text-headline-sm font-bold text-on-surface whitespace-nowrap">
                      {item.calories} <span className="text-label-sm font-label-sm font-normal text-on-surface-variant">kcal</span>
                    </td>
                    <td className="py-3.5 px-3 text-right font-code-data text-code-data text-on-surface whitespace-nowrap">
                      <span className="font-bold text-primary">{item.protein.toFixed(1)}</span> g
                    </td>
                    <td className="py-3.5 px-3 text-right font-code-data text-code-data text-on-surface whitespace-nowrap">
                      {item.carbs.toFixed(1)} g
                    </td>
                    <td className="py-3.5 px-3 text-right font-code-data text-code-data text-on-surface whitespace-nowrap">
                      {item.fats.toFixed(1)} g
                    </td>
                    <td className="py-3.5 px-3 text-center whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-label-sm font-label-sm font-medium ${
                          item.source === 'Manual'
                            ? 'bg-primary-fixed text-on-primary-fixed'
                            : item.source === 'Plantilla'
                            ? 'bg-surface-container-high text-on-surface-variant'
                            : 'bg-secondary-fixed text-on-secondary-fixed'
                        }`}
                      >
                        <span className="material-symbols-outlined text-xs">
                          {item.source === 'Manual' ? 'verified' : item.source === 'Plantilla' ? 'auto_awesome' : 'book'}
                        </span>
                        {item.source}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      <div className="flex items-center justify-center gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={openMealDrawer}
                          className="p-1 rounded hover:bg-surface-container text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
                          title="Editar fila"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-base">edit</span>
                        </button>
                        <button
                          onClick={() => duplicateMealLog(item.id)}
                          className="p-1 rounded hover:bg-surface-container text-on-surface-variant hover:text-primary transition-colors cursor-pointer"
                          title="Duplicar a hoy"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-base">content_copy</span>
                        </button>
                        <button
                          onClick={() => deleteMealLog(item.id)}
                          className="p-1 rounded hover:bg-surface-container text-on-surface-variant hover:text-error transition-colors cursor-pointer"
                          title="Eliminar registro"
                          type="button"
                        >
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-space-md bg-surface-container-low/40 flex flex-col md:flex-row items-center justify-between gap-space-md border-t border-surface-container/40">
          <div className="flex items-center gap-space-sm text-on-surface-variant font-label-md text-label-md">
            <span>Filas por página:</span>
            <div className="relative">
              <select
                value={rowsPerPage}
                onChange={e => {
                  setRowsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="appearance-none bg-surface-container-lowest text-on-surface font-semibold pl-3 pr-7 py-1 rounded border border-surface-container shadow-xs cursor-pointer focus:outline-none"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
              </select>
              <span className="material-symbols-outlined absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-on-surface-variant pointer-events-none">
                expand_more
              </span>
            </div>
            <span className="text-on-surface-variant/70">|</span>
            <span>
              Página <strong className="text-on-surface">{currentPage}</strong> de{' '}
              <strong className="text-on-surface">{totalPages}</strong>
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage <= 1}
              className="px-3 py-1.5 rounded bg-surface-container-lowest text-on-surface font-label-md text-label-md shadow-xs flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              type="button"
            >
              <span className="material-symbols-outlined text-sm">chevron_left</span>
              <span>Anterior</span>
            </button>
            <span className="w-8 h-8 rounded bg-primary text-on-primary font-label-md text-label-md font-semibold flex items-center justify-center shadow-xs">
              {currentPage}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage >= totalPages}
              className="px-3 py-1.5 rounded bg-surface-container-lowest hover:bg-surface-container text-on-surface font-label-md text-label-md shadow-xs flex items-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              type="button"
            >
              <span>Siguiente</span>
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
