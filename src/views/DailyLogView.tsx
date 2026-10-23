import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export const DailyLogView: React.FC = () => {
  const { openMealDrawer, showToast, todaySummary, mealLogs } = useApp();

  const [activeViewMode, setActiveViewMode] = useState<'timeline' | 'matrix' | 'table'>('timeline');
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(3); // Jue 24 by default

  const daysData = [
    {
      label: 'Lun 21',
      dayNum: 21,
      status: 'complete',
      statusText: 'Completo',
      kcal: 2280,
      p: 148,
      weight: 74.7,
      activity: 'Torso Pesado',
      activityIcon: 'fitness_center',
    },
    {
      label: 'Mar 22',
      dayNum: 22,
      status: 'complete',
      statusText: 'Completo',
      kcal: 2310,
      p: 152,
      weight: 74.6,
      activity: 'Pierna Fuerza',
      activityIcon: 'fitness_center',
    },
    {
      label: 'Mié 23',
      dayNum: 23,
      status: 'complete',
      statusText: 'Completo',
      kcal: 2240,
      p: 145,
      weight: 74.5,
      activity: 'Descanso Act.',
      activityIcon: 'bedtime',
    },
    {
      label: 'Jue 24',
      dayNum: 24,
      status: 'partial',
      statusText: 'Parcial',
      kcal: todaySummary.calories,
      p: todaySummary.protein,
      weight: 74.5,
      isToday: true,
      activity: 'Empuje + HIIT',
      activityIcon: 'bolt',
    },
    {
      label: 'Vie 25',
      dayNum: 25,
      status: 'null',
      statusText: 'Vacío (NULL)',
      kcal: null,
      p: null,
      weight: null,
      activity: 'Tracción / Jalón',
      activityIcon: 'fitness_center',
    },
    {
      label: 'Sáb 26',
      dayNum: 26,
      status: 'null',
      statusText: 'Vacío (NULL)',
      kcal: null,
      p: null,
      weight: null,
      activity: 'Pierna Posterior',
      activityIcon: 'fitness_center',
    },
    {
      label: 'Dom 27',
      dayNum: 27,
      status: 'null',
      statusText: 'Vacío (NULL)',
      kcal: null,
      p: null,
      weight: null,
      activity: 'Descanso Total',
      activityIcon: 'bedtime',
    },
  ];

  const currentDay = daysData[selectedDayIndex];

  const handleDeclareFasting = () => {
    showToast('Ayuno declarado: 0 kcal registradas para el día (no sesga como NULL)');
  };

  const handleCloseAudit = () => {
    showToast('¡Día cerrado y auditado con éxito!');
  };

  return (
    <div className="p-4 sm:p-gutter-desktop max-w-[1440px] mx-auto w-full flex flex-col gap-space-xl animate-in fade-in duration-150">
      {/* Header Section */}
      <header className="flex flex-col gap-space-md">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md">
          <div className="flex flex-col gap-space-xs">
            <div className="flex items-center gap-space-sm">
              <span className="font-label-sm text-label-sm tracking-wider uppercase text-primary font-semibold">
                Auditoría Temporal Telemetría
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-outline-variant" />
              <span className="font-label-sm text-label-sm text-secondary font-medium">
                Protocolo 180 Días (26 Semanas)
              </span>
            </div>
            <h1 className="font-headline-lg text-headline-lg text-on-surface font-semibold tracking-tight">
              Registro Diario
            </h1>
            <p className="font-body-md text-body-md text-on-surface-variant max-w-3xl">
              Línea temporal y auditoría cronológica del protocolo de 180 días (26 semanas). Distinción estricta de calidad del dato sin sesgar los promedios con ceros ficticios.
            </p>
          </div>

          {/* View Switcher */}
          <div className="flex items-center self-start lg:self-auto bg-surface-container p-1 rounded-xl shadow-xs border border-surface-container-high">
            <button
              onClick={() => setActiveViewMode('timeline')}
              className={`flex items-center gap-space-xs px-space-md py-1.5 rounded-lg font-label-md text-label-md transition-all ${
                activeViewMode === 'timeline'
                  ? 'bg-surface-container-lowest text-primary shadow-xs font-semibold'
                  : 'text-secondary hover:text-on-surface'
              }`}
              type="button"
            >
              <span className="material-symbols-outlined text-base">view_timeline</span>
              <span>Línea Temporal (Cards)</span>
            </button>
            <button
              onClick={() => setActiveViewMode('matrix')}
              className={`flex items-center gap-space-xs px-space-md py-1.5 rounded-lg font-label-md text-label-md transition-all ${
                activeViewMode === 'matrix'
                  ? 'bg-surface-container-lowest text-primary shadow-xs font-semibold'
                  : 'text-secondary hover:text-on-surface'
              }`}
              type="button"
            >
              <span className="material-symbols-outlined text-base">calendar_view_month</span>
              <span>Matriz Mensual</span>
            </button>
            <button
              onClick={() => setActiveViewMode('table')}
              className={`flex items-center gap-space-xs px-space-md py-1.5 rounded-lg font-label-md text-label-md transition-all ${
                activeViewMode === 'table'
                  ? 'bg-surface-container-lowest text-primary shadow-xs font-semibold'
                  : 'text-secondary hover:text-on-surface'
              }`}
              type="button"
            >
              <span className="material-symbols-outlined text-base">table_rows</span>
              <span>Tabla Compacta</span>
            </button>
          </div>
        </div>

        {/* Macro Program Progress Card */}
        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-space-lg">
          <div className="flex items-center gap-space-lg min-w-0">
            <div className="relative w-14 h-14 shrink-0 flex items-center justify-center bg-primary/10 rounded-full">
              <svg className="w-14 h-14 -rotate-90" viewBox="0 0 36 36">
                <path
                  className="text-surface-container"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3.5"
                />
                <path
                  className="text-primary"
                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                  fill="none"
                  stroke="currentColor"
                  strokeDasharray="13.3, 100"
                  strokeLinecap="round"
                  strokeWidth="3.5"
                />
              </svg>
              <span className="absolute font-label-sm text-label-sm text-primary font-bold">13.3%</span>
            </div>
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-space-sm flex-wrap">
                <span className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Día 24 de 180 completados
                </span>
                <span className="bg-primary/10 text-primary font-label-sm text-label-sm px-2.5 py-0.5 rounded-full font-semibold">
                  Semana 4 de 26
                </span>
              </div>
              <p className="font-body-md text-body-md text-on-surface-variant truncate">
                Fase metabólica: <strong className="text-on-surface font-medium">Déficit Moderado (-400 kcal)</strong> • Tasa estimada de pérdida: 0.45 kg/semana
              </p>
            </div>
          </div>

          <div className="flex items-center gap-space-md justify-between md:justify-end border-t md:border-t-0 pt-space-sm md:pt-0 border-surface-container">
            <div className="flex flex-col text-left md:text-right">
              <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">Varianza Global</span>
              <span className="font-metric-md text-metric-md text-primary font-bold tracking-tight">-1.8 kg</span>
            </div>
            <div className="h-8 w-px bg-surface-container" />
            <div className="flex flex-col text-left md:text-right">
              <span className="font-label-sm text-label-sm text-secondary uppercase font-semibold">Precisión Diaria</span>
              <span className="font-metric-md text-metric-md text-on-surface font-bold tracking-tight">96.8%</span>
            </div>
            <div className="h-8 w-px bg-surface-container" />
            <button
              onClick={() => showToast('Descargando archivo CSV de 180 días...')}
              className="bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md px-space-md py-2 rounded-lg flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
              type="button"
            >
              <span className="material-symbols-outlined text-base">download</span>
              <span>Exportar CSV</span>
            </button>
          </div>
        </div>
      </header>

      {/* Data Quality Legend */}
      <section className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-md">
          <div className="flex items-center gap-space-sm shrink-0">
            <span className="material-symbols-outlined text-primary text-xl">verified_user</span>
            <div className="flex flex-col">
              <span className="font-label-md text-label-md text-on-surface font-semibold">Control de Calidad de Datos</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">Lógica Supabase &amp; Rigor Estadístico</span>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-sm w-full">
            <div className="flex items-start gap-space-xs p-space-xs rounded-lg bg-surface-container-low border border-surface-container/40">
              <span className="w-3 h-3 mt-1 rounded-full bg-primary shrink-0 shadow-xs" />
              <div className="flex flex-col">
                <span className="font-label-md text-label-md font-semibold text-primary">Día Completo (100%)</span>
                <p className="font-label-sm text-label-sm text-on-surface-variant leading-tight">
                  4 tomas, kcal dentro del ±5%, sesión de entreno auditada.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-space-xs p-space-xs rounded-lg bg-surface-container-low border border-surface-container/40">
              <span className="w-3 h-3 mt-1 rounded-full bg-amber-500 shrink-0 shadow-xs" />
              <div className="flex flex-col">
                <span className="font-label-md text-label-md font-semibold text-amber-800">Registro Parcial</span>
                <p className="font-label-sm text-label-sm text-on-surface-variant leading-tight">
                  1 a 3 tomas; en curso. No computa como día cerrado.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-space-xs p-space-xs rounded-lg bg-surface-container-low border border-surface-container/40">
              <span className="w-3 h-3 mt-1 rounded-full bg-secondary shrink-0 shadow-xs" />
              <div className="flex flex-col">
                <span className="font-label-md text-label-md font-semibold text-secondary">Registrado en Cero</span>
                <p className="font-label-sm text-label-sm text-on-surface-variant leading-tight">
                  Ayuno consciente (0 kcal). Ingresa al modelo como valor real.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-space-xs p-space-xs rounded-lg bg-surface-container-low border border-surface-container/40">
              <span className="w-3 h-3 mt-1 rounded-full bg-transparent border-2 border-dashed border-secondary/60 shrink-0" />
              <div className="flex flex-col">
                <span className="font-label-md text-label-md font-semibold text-on-surface-variant">Sin Registrar (NULL)</span>
                <p className="font-label-sm text-label-sm text-on-surface-variant leading-tight">
                  Celda nula en BD. NO promedia cero en análisis metabólico.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Weekly Navigator & 7 Days Matrix */}
      <section className="flex flex-col gap-space-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <div className="flex items-center bg-surface-container rounded-lg p-0.5 shadow-xs">
              <button
                onClick={() => showToast('Cargando semana anterior...')}
                className="p-1 hover:bg-surface-container-lowest text-on-surface-variant hover:text-on-surface rounded transition-colors"
                title="Semana anterior"
                type="button"
              >
                <span className="material-symbols-outlined text-lg">chevron_left</span>
              </button>
              <span className="px-space-md font-label-md text-label-md text-on-surface font-semibold">
                Semana 4 (21 Oct - 27 Oct)
              </span>
              <button
                onClick={() => showToast('Cargando semana siguiente...')}
                className="p-1 hover:bg-surface-container-lowest text-on-surface-variant hover:text-on-surface rounded transition-colors"
                title="Semana siguiente"
                type="button"
              >
                <span className="material-symbols-outlined text-lg">chevron_right</span>
              </button>
            </div>
            <span className="font-label-sm text-label-sm text-on-surface-variant hidden sm:inline">
              Objetivo Diario: 2,300 kcal • 149g Proteína
            </span>
          </div>

          <div className="flex items-center gap-space-xs">
            <span className="font-label-sm text-label-sm text-secondary font-medium">Cumplimiento Semanal:</span>
            <span className="font-label-md text-label-md text-primary font-bold">85.7%</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-space-sm">
          {daysData.map((d, index) => {
            const isSelected = selectedDayIndex === index;
            return (
              <div
                key={d.label}
                onClick={() => setSelectedDayIndex(index)}
                className={`rounded-xl p-space-md shadow-xs flex flex-col justify-between cursor-pointer transition-all border ${
                  isSelected
                    ? 'bg-surface-container-lowest ring-2 ring-primary border-transparent shadow-md'
                    : d.status === 'null'
                    ? 'bg-surface-container-low/60 border-surface-container/50 opacity-70 hover:opacity-100'
                    : 'bg-surface-container-lowest border-surface-container/50 hover:shadow-md'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className={`font-label-sm text-label-sm uppercase tracking-wide ${isSelected ? 'text-primary font-bold' : 'text-secondary'}`}>
                      {d.label}
                    </span>
                    <p className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                      Día {d.dayNum}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                      d.status === 'complete'
                        ? 'bg-primary/10 text-primary'
                        : d.status === 'partial'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-surface-container text-secondary'
                    }`}
                  >
                    {d.statusText}
                  </span>
                </div>

                <div className="flex flex-col gap-1 my-space-sm">
                  <div className="flex items-baseline justify-between">
                    <span className="font-label-sm text-label-sm text-on-surface-variant">Calorías</span>
                    <span className="font-label-md text-label-md text-on-surface font-semibold">
                      {d.kcal ? `${d.kcal} kcal` : '--'}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="font-label-sm text-label-sm text-on-surface-variant">Proteínas</span>
                    <span className="font-label-md text-label-md text-on-surface font-semibold">
                      {d.p ? `${d.p}g` : '--'}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between">
                    <span className="font-label-sm text-label-sm text-on-surface-variant">Peso Ayunas</span>
                    <span className="font-label-md text-label-md text-on-surface font-semibold">
                      {d.weight ? `${d.weight} kg` : '--'}
                    </span>
                  </div>
                </div>

                <div className="pt-space-xs border-t border-surface-container flex items-center justify-between">
                  <span className="font-label-sm text-[11px] text-primary flex items-center gap-1 font-medium">
                    <span className="material-symbols-outlined text-sm">{d.activityIcon}</span>
                    <span className="truncate">{d.activity}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Selected Day Audit Detail */}
      <section className="flex flex-col gap-space-lg">
        {/* Status Alert Banner */}
        <div className="bg-amber-500/10 rounded-xl p-space-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-space-md border border-amber-500/20">
          <div className="flex items-center gap-space-sm">
            <span className="p-2 rounded-lg bg-amber-500/20 text-amber-800 material-symbols-outlined text-xl">
              pending_actions
            </span>
            <div>
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                Auditoría del Día: {currentDay.label} de Octubre 2024
              </h2>
              <p className="font-body-md text-body-md text-amber-900">
                Estado: <strong>{currentDay.statusText}</strong> ({currentDay.status === 'partial' ? '3 de 4 tomas realizadas • Falta confirmación de Cena' : currentDay.status === 'complete' ? 'Todas las tomas registradas y verificadas' : 'Día pendiente de registro'}).
              </p>
            </div>
          </div>
          <div className="flex items-center gap-space-xs self-end sm:self-auto">
            <button
              onClick={handleDeclareFasting}
              className="bg-surface-container-lowest hover:bg-surface-container text-on-surface font-label-md text-label-md px-space-md py-1.5 rounded-lg shadow-xs transition-colors flex items-center gap-1 cursor-pointer border border-surface-container"
              type="button"
            >
              <span className="material-symbols-outlined text-base">fastfood</span>
              <span>Declarar Ayuno (0 kcal)</span>
            </button>
            <button
              onClick={handleCloseAudit}
              className="bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md px-space-md py-1.5 rounded-lg shadow-sm transition-colors flex items-center gap-1 cursor-pointer font-medium"
              type="button"
            >
              <span className="material-symbols-outlined text-base">check</span>
              <span>Cerrar Día Auditado</span>
            </button>
          </div>
        </div>

        {/* 5 Metrics Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-space-md">
          <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-secondary">
              <span className="font-label-sm text-label-sm uppercase font-semibold">Balance Calórico</span>
              <span className="material-symbols-outlined text-base text-primary">local_fire_department</span>
            </div>
            <div className="my-space-xs">
              <div className="flex items-baseline gap-1">
                <span className="font-metric-xl text-metric-xl text-on-surface">
                  {currentDay.kcal || 0}
                </span>
                <span className="font-label-md text-label-md text-secondary">/ 2,300 kcal</span>
              </div>
              <div className="w-full bg-surface-container rounded-full h-1.5 mt-2 overflow-hidden">
                <div
                  className="bg-primary h-1.5 rounded-full"
                  style={{ width: `${Math.min(100, Math.round(((currentDay.kcal || 0) / 2300) * 100))}%` }}
                />
              </div>
            </div>
            <span className="font-label-sm text-label-sm text-primary font-medium flex items-center gap-1">
              <span className="material-symbols-outlined text-xs">arrow_forward</span>{' '}
              {Math.max(0, 2300 - (currentDay.kcal || 0))} kcal restantes
            </span>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-secondary">
              <span className="font-label-sm text-label-sm uppercase font-semibold">Proteína Meta</span>
              <span className="material-symbols-outlined text-base text-primary">fitness_center</span>
            </div>
            <div className="my-space-xs">
              <div className="flex items-baseline gap-1">
                <span className="font-metric-xl text-metric-xl text-on-surface">{currentDay.p || 0}</span>
                <span className="font-label-md text-label-md text-secondary">/ 149 g</span>
              </div>
              <div className="w-full bg-surface-container rounded-full h-1.5 mt-2 overflow-hidden">
                <div
                  className="bg-primary h-1.5 rounded-full"
                  style={{ width: `${Math.min(100, Math.round(((currentDay.p || 0) / 149) * 100))}%` }}
                />
              </div>
            </div>
            <span className="font-label-sm text-label-sm text-primary font-medium">
              {Math.round(((currentDay.p || 0) / 149) * 100)}% completado
            </span>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-secondary">
              <span className="font-label-sm text-label-sm uppercase font-semibold">Peso en Ayunas</span>
              <button
                onClick={() => showToast('Abriendo registro rápido de peso...')}
                className="text-secondary hover:text-primary transition-colors p-0.5 cursor-pointer"
                title="Editar peso"
                type="button"
              >
                <span className="material-symbols-outlined text-base">edit</span>
              </button>
            </div>
            <div className="my-space-xs">
              <div className="flex items-baseline gap-1">
                <span className="font-metric-xl text-metric-xl text-on-surface">
                  {currentDay.weight || '--'}
                </span>
                <span className="font-label-md text-label-md text-secondary">kg</span>
              </div>
              <span className="font-label-sm text-label-sm text-primary font-medium flex items-center gap-0.5">
                <span className="material-symbols-outlined text-xs">trending_down</span> -0.2 kg vs Lun 21
              </span>
            </div>
            <span className="font-label-sm text-label-sm text-on-surface-variant">Báscula conectada 07:10 AM</span>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-secondary">
              <span className="font-label-sm text-label-sm uppercase font-semibold">Pasos / NEAT</span>
              <span className="material-symbols-outlined text-base text-primary">directions_walk</span>
            </div>
            <div className="my-space-xs">
              <div className="flex items-baseline gap-1">
                <span className="font-metric-xl text-metric-xl text-on-surface">9,420</span>
                <span className="font-label-md text-label-md text-secondary">/ 10k</span>
              </div>
              <div className="w-full bg-surface-container rounded-full h-1.5 mt-2 overflow-hidden">
                <div className="bg-primary h-1.5 rounded-full" style={{ width: '94.2%' }} />
              </div>
            </div>
            <span className="font-label-sm text-label-sm text-on-surface-variant">Apple Health Sincronizado</span>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-secondary">
              <span className="font-label-sm text-label-sm uppercase font-semibold">Hidratación</span>
              <span className="material-symbols-outlined text-base text-tertiary">water_drop</span>
            </div>
            <div className="my-space-xs">
              <div className="flex items-baseline gap-1">
                <span className="font-metric-xl text-metric-xl text-on-surface">2.4</span>
                <span className="font-label-md text-label-md text-secondary">/ 3.2 L</span>
              </div>
              <div className="w-full bg-surface-container rounded-full h-1.5 mt-2 overflow-hidden">
                <div className="bg-tertiary h-1.5 rounded-full" style={{ width: '75%' }} />
              </div>
            </div>
            <span className="font-label-sm text-label-sm text-on-surface-variant">+800 ml requeridos post-cena</span>
          </div>
        </div>

        {/* Meals Chronology + SQL Integrity Split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
          {/* Meals List (8 cols) */}
          <div className="lg:col-span-8 bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
            <div className="flex items-center justify-between pb-2 border-b border-surface-container/40">
              <div className="flex items-center gap-space-sm">
                <span className="material-symbols-outlined text-primary">restaurant</span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Cronología de Ingestas Auditadas
                </h3>
              </div>
              <button
                onClick={openMealDrawer}
                className="bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md px-space-md py-1 rounded-lg flex items-center gap-1 transition-colors cursor-pointer"
                type="button"
              >
                <span className="material-symbols-outlined text-base text-primary">add</span>
                <span>Añadir toma libre</span>
              </button>
            </div>

            <div className="flex flex-col gap-space-sm">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-space-md rounded-xl bg-surface-container-low gap-space-md border border-surface-container/40">
                <div className="flex items-start gap-space-md">
                  <div className="flex flex-col items-center justify-center bg-surface-container-lowest px-2.5 py-1.5 rounded-lg shadow-xs min-w-[64px]">
                    <span className="font-label-sm text-label-sm font-semibold text-primary">08:15</span>
                    <span className="font-label-sm text-[10px] text-secondary uppercase">AM</span>
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-space-xs">
                      <span className="font-label-md text-label-md font-semibold text-on-surface">Desayuno</span>
                      <span className="inline-flex items-center gap-0.5 bg-primary/10 text-primary font-label-sm text-[10px] px-2 py-0.2 rounded-full font-semibold">
                        <span className="material-symbols-outlined text-xs">check</span> Verificado
                      </span>
                    </div>
                    <p className="font-body-md text-body-md text-on-surface">
                      Huevos con espinacas y avena en hojuelas
                    </p>
                    <span className="font-label-sm text-label-sm text-on-surface-variant font-mono">
                      560 kcal • 36g P • 48g C • 20g G
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-space-md rounded-xl bg-surface-container-low gap-space-md border border-surface-container/40">
                <div className="flex items-start gap-space-md">
                  <div className="flex flex-col items-center justify-center bg-surface-container-lowest px-2.5 py-1.5 rounded-lg shadow-xs min-w-[64px]">
                    <span className="font-label-sm text-label-sm font-semibold text-primary">13:15</span>
                    <span className="font-label-sm text-[10px] text-secondary uppercase">PM</span>
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-space-xs">
                      <span className="font-label-md text-label-md font-semibold text-on-surface">Almuerzo</span>
                      <span className="inline-flex items-center gap-0.5 bg-primary/10 text-primary font-label-sm text-[10px] px-2 py-0.2 rounded-full font-semibold">
                        <span className="material-symbols-outlined text-xs">check</span> Verificado
                      </span>
                    </div>
                    <p className="font-body-md text-body-md text-on-surface">
                      Pechuga a la plancha con arroz blanco y aguacate Hass
                    </p>
                    <span className="font-label-sm text-label-sm text-on-surface-variant font-mono">
                      810 kcal • 64g P • 78g C • 24g G
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-space-md rounded-xl bg-surface-container-low gap-space-md border border-surface-container/40">
                <div className="flex items-start gap-space-md">
                  <div className="flex flex-col items-center justify-center bg-surface-container-lowest px-2.5 py-1.5 rounded-lg shadow-xs min-w-[64px]">
                    <span className="font-label-sm text-label-sm font-semibold text-primary">17:00</span>
                    <span className="font-label-sm text-[10px] text-secondary uppercase">PM</span>
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-space-xs">
                      <span className="font-label-md text-label-md font-semibold text-on-surface">Merienda</span>
                      <span className="inline-flex items-center gap-0.5 bg-primary/10 text-primary font-label-sm text-[10px] px-2 py-0.2 rounded-full font-semibold">
                        <span className="material-symbols-outlined text-xs">check</span> Verificado
                      </span>
                    </div>
                    <p className="font-body-md text-body-md text-on-surface">
                      Yogur griego natural con almendras y arándanos
                    </p>
                    <span className="font-label-sm text-label-sm text-on-surface-variant font-mono">
                      335 kcal • 24g P • 18g C • 16g G
                    </span>
                  </div>
                </div>
              </div>

              {/* Cena (Pending) */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-space-md rounded-xl bg-surface-container/60 gap-space-md border border-surface-container/80">
                <div className="flex items-start gap-space-md">
                  <div className="flex flex-col items-center justify-center bg-surface-container-lowest px-2.5 py-1.5 rounded-lg shadow-xs min-w-[64px]">
                    <span className="font-label-sm text-label-sm font-semibold text-secondary">20:30</span>
                    <span className="font-label-sm text-[10px] text-secondary uppercase">PM</span>
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-space-xs">
                      <span className="font-label-md text-label-md font-semibold text-on-surface">Cena Programada</span>
                      <span className="inline-flex items-center gap-0.5 bg-amber-100 text-amber-800 font-label-sm text-[10px] px-2 py-0.2 rounded-full font-semibold">
                        <span className="material-symbols-outlined text-xs">schedule</span> Pendiente nocturna
                      </span>
                    </div>
                    <p className="font-body-md text-body-md text-on-surface">
                      Salmón al horno con batata asada y espárragos
                    </p>
                    <span className="font-label-sm text-label-sm text-secondary font-mono">
                      Meta teórica: ~595 kcal • 42g P • 40g C • 18g G
                    </span>
                  </div>
                </div>
                <button
                  onClick={openMealDrawer}
                  className="bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md px-space-md py-1.5 rounded-lg transition-colors shadow-xs flex items-center gap-1 cursor-pointer self-end sm:self-auto font-medium"
                  type="button"
                >
                  <span className="material-symbols-outlined text-base">check_circle</span>
                  <span>Confirmar Ingesta</span>
                </button>
              </div>
            </div>
          </div>

          {/* Database Integrity & Null Semantics (4 cols) */}
          <div className="lg:col-span-4 flex flex-col gap-space-md">
            <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
              <div className="flex items-center gap-space-sm pb-2 border-b border-surface-container/40">
                <span className="material-symbols-outlined text-primary">terminal</span>
                <div className="flex flex-col">
                  <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                    Integridad de Datos &amp; Cloud Firestore
                  </h3>
                  <span className="font-label-sm text-label-sm text-on-surface-variant">
                    Políticas ABAC y Validación de Esquema
                  </span>
                </div>
              </div>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Los días futuros o no logueados se almacenan estrictamente como{' '}
                <code className="bg-surface-container px-1 py-0.5 rounded text-xs text-on-surface font-mono">
                  NULL
                </code>
                . La función de agregación excluye registros vacíos para evitar la caída artificial del TDEE estimado.
              </p>

              <div className="bg-inverse-surface rounded-xl p-space-md text-inverse-on-surface flex flex-col gap-2 font-mono text-xs overflow-x-auto shadow-inner">
                <div className="flex items-center justify-between text-outline-variant">
                  <span>sql/weekly_rolling_average.sql</span>
                  <span className="material-symbols-outlined text-xs">code</span>
                </div>
                <pre className="text-[11px] leading-relaxed text-inverse-primary">
                  {`SELECT
  week_number,
  AVG(daily_kcal) -- Ignores NULLs
    FILTER (WHERE daily_kcal IS NOT NULL) AS real_avg,
  COUNT(daily_kcal) AS audited_days
FROM vigor_daily_telemetry
WHERE user_id = 'camilo_r'
GROUP BY week_number;`}
                </pre>
              </div>

              <div className="flex items-center gap-2 p-2 rounded-lg bg-surface-container-low text-primary">
                <span className="material-symbols-outlined text-base">verified</span>
                <span className="font-label-sm text-label-sm font-semibold">
                  Supabase Ready • Next.js Server Action Compatible
                </span>
              </div>
            </div>

            <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-sm">
              <h3 className="font-label-md text-label-md text-on-surface font-semibold">
                Nota Biomecánica del Día
              </h3>
              <textarea
                className="w-full bg-surface-container-low border border-surface-container rounded-lg p-space-sm font-body-md text-body-md text-on-surface placeholder:text-secondary focus:ring-1 focus:ring-primary outline-none resize-none"
                placeholder="Añadir sensaciones, fatiga articular, calidad de sueño (RPE, recuperación)..."
                rows={3}
                defaultValue="Sensación de energía sólida durante la sesión de Empuje. Hidratación adecuada post-almuerzo. Sin molestias en hombro derecho."
              />
              <div className="flex justify-end">
                <button
                  onClick={() => showToast('Nota guardada en el historial diario')}
                  className="bg-surface-container hover:bg-surface-container-high text-on-surface font-label-sm text-label-sm px-space-md py-1.5 rounded-lg transition-colors cursor-pointer font-medium"
                  type="button"
                >
                  Guardar Nota
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Historic 26-Week Rolling Averages */}
      <section className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pb-2 border-b border-surface-container/40">
          <div>
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              Historial de Cumplimiento (26 Semanas)
            </h3>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Promedios calóricos reales contrastados contra el gasto metabólico objetivo.
            </p>
          </div>
          <div className="flex items-center gap-space-sm flex-wrap">
            <span className="flex items-center gap-1 font-label-sm text-label-sm text-secondary">
              <span className="w-2.5 h-2.5 rounded-full bg-primary" /> Semana Completa
            </span>
            <span className="flex items-center gap-1 font-label-sm text-label-sm text-secondary">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> En curso
            </span>
            <span className="flex items-center gap-1 font-label-sm text-label-sm text-secondary">
              <span className="w-2.5 h-2.5 rounded-full bg-surface-container" /> Futuras
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-space-md">
          <div className="p-space-md rounded-xl bg-surface-container-low flex flex-col gap-1 border border-surface-container/40">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm font-bold text-on-surface">Semana 1</span>
              <span className="material-symbols-outlined text-primary text-sm">verified</span>
            </div>
            <span className="font-headline-sm text-headline-sm text-on-surface">
              2,310 <span className="font-label-sm text-xs font-normal text-secondary">kcal/d</span>
            </span>
            <div className="flex items-center justify-between font-label-sm text-[11px] text-secondary mt-1">
              <span>7/7 Días</span>
              <span className="text-primary font-semibold">100% Calidad</span>
            </div>
            <div className="w-full bg-surface-container rounded-full h-1 mt-1">
              <div className="bg-primary h-1 rounded-full" style={{ width: '100%' }} />
            </div>
          </div>

          <div className="p-space-md rounded-xl bg-surface-container-low flex flex-col gap-1 border border-surface-container/40">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm font-bold text-on-surface">Semana 2</span>
              <span className="material-symbols-outlined text-primary text-sm">verified</span>
            </div>
            <span className="font-headline-sm text-headline-sm text-on-surface">
              2,295 <span className="font-label-sm text-xs font-normal text-secondary">kcal/d</span>
            </span>
            <div className="flex items-center justify-between font-label-sm text-[11px] text-secondary mt-1">
              <span>7/7 Días</span>
              <span className="text-primary font-semibold">100% Calidad</span>
            </div>
            <div className="w-full bg-surface-container rounded-full h-1 mt-1">
              <div className="bg-primary h-1 rounded-full" style={{ width: '100%' }} />
            </div>
          </div>

          <div className="p-space-md rounded-xl bg-surface-container-low flex flex-col gap-1 border border-surface-container/40">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm font-bold text-on-surface">Semana 3</span>
              <span className="material-symbols-outlined text-primary text-sm">verified</span>
            </div>
            <span className="font-headline-sm text-headline-sm text-on-surface">
              2,280 <span className="font-label-sm text-xs font-normal text-secondary">kcal/d</span>
            </span>
            <div className="flex items-center justify-between font-label-sm text-[11px] text-secondary mt-1">
              <span>7/7 Días</span>
              <span className="text-primary font-semibold">100% Calidad</span>
            </div>
            <div className="w-full bg-surface-container rounded-full h-1 mt-1">
              <div className="bg-primary h-1 rounded-full" style={{ width: '100%' }} />
            </div>
          </div>

          <div className="p-space-md rounded-xl bg-surface-container ring-1 ring-amber-500/40 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm font-bold text-on-surface">Semana 4 (Hoy)</span>
              <span className="w-2 h-2 rounded-full bg-amber-500" />
            </div>
            <span className="font-headline-sm text-headline-sm text-on-surface">
              2,276 <span className="font-label-sm text-xs font-normal text-secondary">kcal/d</span>
            </span>
            <div className="flex items-center justify-between font-label-sm text-[11px] text-secondary mt-1">
              <span>4/7 Registrados</span>
              <span className="text-amber-800 font-semibold">En progreso</span>
            </div>
            <div className="w-full bg-surface-container-highest rounded-full h-1 mt-1">
              <div className="bg-amber-500 h-1 rounded-full" style={{ width: '57%' }} />
            </div>
          </div>

          <div className="p-space-md rounded-xl bg-surface-container/30 flex flex-col gap-1 opacity-60 border border-surface-container/40">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm font-medium text-secondary">Semana 5</span>
              <span className="font-label-sm text-[10px] text-secondary">Fase 1</span>
            </div>
            <span className="font-headline-sm text-headline-sm text-secondary">
              -- <span className="font-label-sm text-xs font-normal text-secondary">kcal</span>
            </span>
            <div className="flex items-center justify-between font-label-sm text-[11px] text-secondary mt-1">
              <span>0/7 Días</span>
              <span>Programada</span>
            </div>
            <div className="w-full bg-surface-container-highest rounded-full h-1 mt-1" />
          </div>

          <div className="p-space-md rounded-xl bg-surface-container/30 flex flex-col justify-between opacity-60 border border-surface-container/40">
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm font-medium text-secondary">Semanas 6 a 26</span>
              <span className="material-symbols-outlined text-secondary text-sm">more_horiz</span>
            </div>
            <p className="font-label-sm text-label-sm text-secondary">
              21 semanas restantes en el protocolo de recomposición.
            </p>
            <span className="font-label-sm text-[11px] text-primary font-medium">Meta Final: 71.0 kg</span>
          </div>
        </div>
      </section>
    </div>
  );
};
