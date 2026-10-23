import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export const TrainingProgressView: React.FC = () => {
  const { showToast, workoutHistory } = useApp();
  const [selectedRange, setSelectedRange] = useState('12w');
  const [activeLiftFilter, setActiveLiftFilter] = useState<'all' | 'banca' | 'sentadilla' | 'peso_muerto' | 'pendlay'>('all');

  // Dynamically compute real 1RM records from Firestore workoutHistory
  const pendlaySets = workoutHistory.filter(w => w.exerciseId === 'pendlay-1' || w.exerciseName.toLowerCase().includes('pendlay') || w.exerciseName.toLowerCase().includes('remo'));
  const maxPendlay1RM = pendlaySets.length > 0 ? Math.max(...pendlaySets.map(s => s.estimated1RM)).toFixed(1) : '95.0';
  const bestPendlayRecord = pendlaySets.length > 0
    ? (() => {
        const best = pendlaySets.reduce((p, c) => (c.estimated1RM > p.estimated1RM ? c : p));
        return `${best.weightKg} kg × ${best.reps} reps @ RIR ${best.rir}`;
      })()
    : '75.0 kg × 8 reps @ RIR 2';

  const bancaSets = workoutHistory.filter(w => w.exerciseId.toLowerCase().includes('banca') || w.exerciseName.toLowerCase().includes('banca'));
  const maxBanca1RM = bancaSets.length > 0 ? Math.max(...bancaSets.map(s => s.estimated1RM)).toFixed(1) : '107.5';
  const bestBancaRecord = bancaSets.length > 0
    ? (() => {
        const best = bancaSets.reduce((p, c) => (c.estimated1RM > p.estimated1RM ? c : p));
        return `${best.weightKg} kg × ${best.reps} reps @ RIR ${best.rir}`;
      })()
    : '85.0 kg × 8 reps @ RIR 1';

  const lifts = [
    {
      id: 'banca',
      category: 'Pecho / Empuje',
      title: 'Press de Banca Plano',
      change: bancaSets.length > 0 ? '+12.1%' : '+10.3%',
      current1RM: maxBanca1RM,
      base1RM: '97.5 kg',
      record: bestBancaRecord,
      sparkline: 'M0 35 L40 32 L80 26 L120 22 L160 14 L200 6',
      circleX: 200,
      circleY: 6,
    },
    {
      id: 'pendlay',
      category: 'Espalda / Tracción',
      title: 'Remo con Barra Pendlay',
      change: pendlaySets.length > 0 ? '+11.4%' : '+8.6%',
      current1RM: maxPendlay1RM,
      base1RM: '87.5 kg',
      record: bestPendlayRecord,
      sparkline: 'M0 36 L40 34 L80 28 L120 24 L160 18 L200 8',
      circleX: 200,
      circleY: 8,
    },
    {
      id: 'sentadilla',
      category: 'Pierna / Rodilla',
      title: 'Sentadilla con Barra',
      change: '+12.5%',
      current1RM: '135.0',
      base1RM: '120.0 kg',
      record: '110.0 kg × 7 reps @ RIR 1',
      sparkline: 'M0 38 L40 32 L80 25 L120 18 L160 12 L200 5',
      circleX: 200,
      circleY: 5,
    },
    {
      id: 'peso_muerto',
      category: 'Cadena Posterior',
      title: 'Peso Muerto Convencional',
      change: '+10.7%',
      current1RM: '155.0',
      base1RM: '140.0 kg',
      record: '130.0 kg × 6 reps @ RIR 1',
      sparkline: 'M0 35 L40 30 L80 26 L120 17 L160 10 L200 4',
      circleX: 200,
      circleY: 4,
    },
  ];

  const filteredLifts = lifts.filter(l => {
    if (activeLiftFilter === 'all') return true;
    return l.id === activeLiftFilter;
  });

  return (
    <div className="p-4 sm:p-gutter-desktop max-w-[1440px] mx-auto w-full flex flex-col gap-space-xl animate-in fade-in duration-150">
      {/* Header Bar */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-space-lg">
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-xs flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-space-sm py-0.5 rounded-full bg-primary-fixed text-on-primary-fixed font-label-sm text-label-sm uppercase tracking-wider font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Mesociclo 1: Volumen Activo (Sem 4/6)
            </span>
            <span className="inline-flex items-center gap-1 px-space-sm py-0.5 rounded-full bg-surface-container-high text-primary font-label-sm text-label-sm font-semibold">
              <span className="material-symbols-outlined text-sm">trending_up</span>
              Delta Tonelaje: +14.2% vs Ciclo Anterior
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface font-semibold tracking-tight">
            Progreso y Analítica del Entrenamiento
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-3xl">
            Auditoría de sobrecarga progresiva, fuerza máxima estimada (1RM), volumen acumulado y monitoreo de fatiga a lo largo de 180 días.
          </p>
        </div>

        <div className="flex items-center gap-space-sm flex-wrap shrink-0">
          <div className="relative">
            <select
              value={selectedRange}
              onChange={e => {
                setSelectedRange(e.target.value);
                showToast(`Recalculando analítica para ${e.target.options[e.target.selectedIndex].text}...`);
              }}
              className="appearance-none bg-surface-container-lowest text-on-surface font-label-md text-label-md py-2 pl-space-md pr-8 rounded-lg shadow-xs focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer border border-surface-container/60"
            >
              <option value="12w">Filtro: Últimas 12 Semanas</option>
              <option value="meso1">Mesociclo 1 (Completo)</option>
              <option value="24w">Últimos 6 Meses (180 días)</option>
              <option value="1y">Temporada 2024</option>
            </select>
            <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-on-surface-variant pointer-events-none">
              expand_more
            </span>
          </div>
          <button
            onClick={() => showToast('Comparando Mesociclo 1 vs Línea Base')}
            className="flex items-center gap-space-xs px-space-md py-2 bg-surface-container-lowest hover:bg-surface-container text-on-surface font-label-md text-label-md rounded-lg shadow-xs transition-colors cursor-pointer border border-surface-container/60"
            type="button"
          >
            <span className="material-symbols-outlined text-base text-on-surface-variant">compare_arrows</span>
            <span>Comparar Mesociclos</span>
          </button>
          <button
            onClick={() => showToast('Generando reporte consolidado CSV / PDF...')}
            className="flex items-center gap-space-xs px-space-md py-2 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg shadow-xs transition-colors cursor-pointer font-medium"
            type="button"
          >
            <span className="material-symbols-outlined text-base">file_download</span>
            <span>Exportar CSV / PDF</span>
          </button>
        </div>
      </div>

      {/* 1. KPIs de Alto Rendimiento */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-space-md">
        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="font-label-sm text-label-sm uppercase tracking-wider font-semibold">
              Tonelaje Total Levantado
            </span>
            <span className="material-symbols-outlined text-base text-primary">fitness_center</span>
          </div>
          <div>
            <div className="flex items-baseline gap-1">
              <span className="font-metric-xl text-metric-xl text-on-surface">148,250</span>
              <span className="font-label-md text-label-md text-on-surface-variant">kg</span>
            </div>
            <div className="flex items-center gap-1.5 mt-space-xs text-primary font-label-sm text-label-sm">
              <span className="material-symbols-outlined text-sm">arrow_upward</span>
              <span className="font-semibold">+18,400 kg</span>
              <span className="text-on-surface-variant font-normal">vs objetivo del ciclo</span>
            </div>
          </div>
          <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
            <div className="bg-primary h-full rounded-full" style={{ width: '82%' }} />
          </div>
        </div>

        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="font-label-sm text-label-sm uppercase tracking-wider font-semibold">
              Fuerza Relativa (DOTS)
            </span>
            <span className="material-symbols-outlined text-base text-primary">military_tech</span>
          </div>
          <div>
            <div className="flex items-baseline gap-1">
              <span className="font-metric-xl text-metric-xl text-on-surface">348.5</span>
              <span className="font-label-md text-label-md text-on-surface-variant">pts</span>
            </div>
            <div className="flex items-center gap-1.5 mt-space-xs text-primary font-label-sm text-label-sm">
              <span className="material-symbols-outlined text-sm">workspace_premium</span>
              <span className="font-semibold">Nivel Avanzado</span>
              <span className="text-on-surface-variant font-normal">(BW: 74.5 kg)</span>
            </div>
          </div>
          <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
            <div className="bg-primary h-full rounded-full" style={{ width: '76%' }} />
          </div>
        </div>

        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="font-label-sm text-label-sm uppercase tracking-wider font-semibold">
              Tasa Cumplimiento Efectivo
            </span>
            <span className="material-symbols-outlined text-base text-primary">check_circle</span>
          </div>
          <div>
            <div className="flex items-baseline gap-1">
              <span className="font-metric-xl text-metric-xl text-on-surface">98.4%</span>
              <span className="font-label-md text-label-md text-on-surface-variant">precisión</span>
            </div>
            <div className="flex items-center gap-1.5 mt-space-xs font-label-sm text-label-sm text-on-surface-variant">
              <span className="font-semibold text-on-surface">134 / 136 series</span>
              <span>a RIR ≤ 2 (alta intensidad)</span>
            </div>
          </div>
          <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
            <div className="bg-primary h-full rounded-full" style={{ width: '98.4%' }} />
          </div>
        </div>

        <div className="bg-surface-container-lowest p-space-md rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-sm">
          <div className="flex items-center justify-between text-on-surface-variant">
            <span className="font-label-sm text-label-sm uppercase tracking-wider font-semibold">
              Ratio Carga ACWR
            </span>
            <span className="material-symbols-outlined text-base text-primary">speed</span>
          </div>
          <div>
            <div className="flex items-baseline gap-1">
              <span className="font-metric-xl text-metric-xl text-on-surface">1.12</span>
              <span className="font-label-md text-label-md text-on-surface-variant">óptimo</span>
            </div>
            <div className="flex items-center gap-1.5 mt-space-xs text-primary font-label-sm text-label-sm">
              <span className="material-symbols-outlined text-sm">shield</span>
              <span className="font-semibold">Zona de Sweet-Spot</span>
              <span className="text-on-surface-variant font-normal">(Rango 0.8 - 1.3)</span>
            </div>
          </div>
          <div className="w-full bg-surface-container rounded-full h-1.5 overflow-hidden">
            <div className="bg-primary h-full rounded-full" style={{ width: '65%' }} />
          </div>
        </div>
      </div>

      {/* 2. Panel Central: 1RM Progresión */}
      <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-md pb-space-sm border-b border-surface-container/30">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-space-xs">
              <span className="material-symbols-outlined text-primary text-xl">insights</span>
              <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
                Progresión de Fuerza en Levantamientos Principales (1RM)
              </h2>
            </div>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Cálculo algorítmico basado en fórmulas de Brzycki / Wathan cruzadas con el RPE efectivo reportado.
            </p>
          </div>
          <div className="flex items-center gap-space-xs bg-surface-container-low p-1 rounded-lg self-start border border-surface-container/40">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'banca', label: 'Banca' },
              { id: 'sentadilla', label: 'Sentadilla' },
              { id: 'peso_muerto', label: 'Peso Muerto' },
              { id: 'pendlay', label: 'Pendlay' },
            ].map(f => (
              <button
                key={f.id}
                onClick={() => setActiveLiftFilter(f.id as any)}
                className={`px-space-sm py-1 rounded-md font-label-sm text-label-sm transition-all ${
                  activeLiftFilter === f.id
                    ? 'bg-surface-container-lowest text-on-surface shadow-xs font-semibold'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                type="button"
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* 4 Lift Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-space-md">
          {filteredLifts.map(lift => (
            <div
              key={lift.id}
              className="bg-surface-container-low p-space-md rounded-xl flex flex-col justify-between gap-space-md transition-all hover:bg-surface-container border border-surface-container/40"
            >
              <div className="flex justify-between items-start">
                <div className="flex flex-col">
                  <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold">
                    {lift.category}
                  </span>
                  <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                    {lift.title}
                  </h3>
                </div>
                <span className="px-space-xs py-0.5 rounded bg-surface-container-lowest text-primary font-code-data text-code-data font-bold shadow-xs">
                  {lift.change}
                </span>
              </div>

              <div className="flex items-baseline gap-2">
                <span className="font-metric-xl text-metric-xl text-on-surface font-bold">
                  {lift.current1RM}
                </span>
                <span className="font-label-md text-label-md text-on-surface-variant">kg 1RM</span>
                <span className="text-on-surface-variant/80 font-code-data text-code-data ml-auto">
                  Base: {lift.base1RM}
                </span>
              </div>

              <div className="w-full h-10">
                <svg className="w-full h-full text-primary" fill="none" preserveAspectRatio="none" viewBox="0 0 200 40">
                  <path
                    d={lift.sparkline}
                    stroke="currentColor"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2.5"
                  />
                  <circle className="fill-primary" cx={lift.circleX} cy={lift.circleY} r="4" />
                </svg>
              </div>

              <div className="pt-space-xs bg-surface-container-lowest/60 p-2 rounded-lg flex flex-col gap-0.5 border border-surface-container/30">
                <span className="font-label-sm text-label-sm text-on-surface-variant font-medium">Récord Reciente:</span>
                <span className="font-code-data text-code-data text-on-surface font-semibold">{lift.record}</span>
              </div>
            </div>
          ))}
        </div>

        {/* 12-Week Evolution Chart */}
        <div className="bg-surface-container-low p-space-lg rounded-xl flex flex-col gap-space-md border border-surface-container/40">
          <div className="flex items-center justify-between flex-wrap gap-space-sm">
            <div className="flex items-center gap-space-sm">
              <span className="font-label-md text-label-md font-semibold text-on-surface">
                Curva de 1RM Compuesto µCargas (+1.25 kg/sem)
              </span>
              <span className="h-2 w-2 rounded-full bg-primary" />
            </div>
            <div className="flex items-center gap-space-md font-code-data text-code-data text-on-surface-variant">
              <span className="flex items-center gap-1.5"><span className="h-2 w-3 bg-primary rounded-sm inline-block" /> Peso Muerto</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-3 bg-primary-container rounded-sm inline-block" /> Sentadilla</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-3 bg-tertiary rounded-sm inline-block" /> Banca</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-3 bg-secondary rounded-sm inline-block" /> Pendlay</span>
            </div>
          </div>

          <div className="w-full h-64 relative">
            <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 800 200">
              <line stroke="#bccac0" strokeDasharray="3 3" strokeOpacity="0.3" x1="0" x2="800" y1="20" y2="20" />
              <line stroke="#bccac0" strokeDasharray="3 3" strokeOpacity="0.3" x1="0" x2="800" y1="65" y2="65" />
              <line stroke="#bccac0" strokeDasharray="3 3" strokeOpacity="0.3" x1="0" x2="800" y1="110" y2="110" />
              <line stroke="#bccac0" strokeDasharray="3 3" strokeOpacity="0.3" x1="0" x2="800" y1="155" y2="155" />

              <path d="M 0 55 Q 160 52, 320 40 T 640 28 L 800 20" fill="none" stroke="#006948" strokeWidth="3" />
              <path d="M 0 95 Q 160 90, 320 80 T 640 68 L 800 60" fill="none" stroke="#00855d" strokeWidth="2.5" />
              <path d="M 0 145 Q 160 140, 320 132 T 640 125 L 800 118" fill="none" stroke="#006194" strokeWidth="2.5" />
              <path d="M 0 170 Q 160 168, 320 160 T 640 152 L 800 145" fill="none" stroke="#565e74" strokeWidth="2" />

              <circle cx="800" cy="20" fill="#006948" r="5" className="ring-4 ring-primary-fixed" />
              <circle cx="800" cy="60" fill="#00855d" r="4" />
              <circle cx="800" cy="118" fill="#006194" r="4" />
              <circle cx="800" cy="145" fill="#565e74" r="4" />
            </svg>
            <div className="flex justify-between text-on-surface-variant font-code-data text-code-data pt-2">
              <span>Sem 1</span>
              <span>Sem 2</span>
              <span>Sem 3</span>
              <span>Sem 4</span>
              <span>Sem 5</span>
              <span>Sem 6</span>
              <span>Sem 7</span>
              <span>Sem 8</span>
              <span>Sem 9</span>
              <span>Sem 10</span>
              <span>Sem 11</span>
              <span className="text-primary font-bold">Sem 12 (Hoy)</span>
            </div>
          </div>
        </div>
      </div>

      {/* 3 & 4. Volume Landmarks & Systemic Fatigue */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        {/* Muscle Landmarks (7 cols) */}
        <div className="lg:col-span-7 bg-surface-container-lowest p-space-lg rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-lg">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
                Landmarks Hipertróficos Semanales
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-surface-container-high text-on-surface font-code-data text-code-data font-semibold">
                RP Strength Protocol
              </span>
            </div>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Comparativa de volumen efectivo directo frente a MEV (Mínimo), MAV (Adaptativo Óptimo) y MRV (Máximo Recuperable).
            </p>
          </div>

          <div className="flex items-center gap-space-md text-on-surface-variant font-label-sm text-label-sm border-b border-surface-container pb-space-sm flex-wrap">
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-secondary-fixed" /> MEV (Mínimo)</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" /> Volumen Actual (Semana 4)</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-surface-container-highest" /> MAV (Rango Óptimo)</span>
            <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-error-container" /> MRV (Límite Fatiga)</span>
          </div>

          <div className="flex flex-col gap-space-md">
            {[
              { name: 'Pectoral Mayor y Menor', sets: 16, mav: '14-20', width: '68%' },
              { name: 'Espalda & Dorsales', sets: 18, mav: '16-22', width: '75%' },
              { name: 'Cuádriceps', sets: 14, mav: '12-18', width: '64%' },
              { name: 'Isquios & Glúteos', sets: 12, mav: '10-16', width: '58%' },
              { name: 'Deltoides Lateral & Posterior', sets: 18, mav: '16-22', width: '76%' },
              { name: 'Brazos (Bíceps & Tríceps)', sets: 14, mav: '10-16', width: '62%' },
            ].map(m => (
              <div key={m.name} className="flex flex-col gap-1">
                <div className="flex justify-between items-center font-label-md text-label-md">
                  <span className="font-semibold text-on-surface">{m.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-primary font-bold font-code-data text-code-data">{m.sets} series</span>
                    <span className="text-on-surface-variant text-label-sm">(MAV: {m.mav})</span>
                    <span className="px-1.5 py-0.5 rounded bg-primary-fixed text-on-primary-fixed font-label-sm text-label-sm font-semibold">
                      Óptimo
                    </span>
                  </div>
                </div>
                <div className="w-full bg-surface-container-low h-3 rounded-full relative overflow-hidden flex items-center border border-surface-container/30">
                  <div className="bg-primary h-full rounded-full" style={{ width: m.width }} />
                  <div className="absolute left-[88%] top-0 bottom-0 w-0.5 bg-error" title="MRV Límite" />
                </div>
              </div>
            ))}
          </div>

          <div className="p-space-sm bg-surface-container-low rounded-lg flex items-center gap-space-sm border border-surface-container/40">
            <span className="material-symbols-outlined text-primary text-base">info</span>
            <span className="font-body-md text-body-md text-on-surface-variant text-xs">
              Todas las áreas permanecen dentro de su banda de estimulación hipertrófica sin rozar el MRV. Carga biológica sostenible.
            </span>
          </div>
        </div>

        {/* Fatigue & Recovery (5 cols) */}
        <div className="lg:col-span-5 bg-surface-container-lowest p-space-lg rounded-xl shadow-xs border border-surface-container/50 flex flex-col justify-between gap-space-lg">
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
                Fatiga Sistémica y Sueño
              </h2>
              <span className="material-symbols-outlined text-primary">bedtime</span>
            </div>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Correlación de esfuerzo subjetivo (RIR), descanso REM/profundo y dolor muscular tardío (DOMS).
            </p>
          </div>

          <div className="grid grid-cols-3 gap-space-xs text-center">
            <div className="bg-surface-container-low p-space-sm rounded-lg flex flex-col border border-surface-container/30">
              <span className="font-label-sm text-label-sm text-on-surface-variant">RIR Medio</span>
              <span className="font-metric-md text-metric-md text-on-surface font-bold">1.6</span>
              <span className="font-code-data text-code-data text-primary font-medium">± 0.2 series</span>
            </div>
            <div className="bg-surface-container-low p-space-sm rounded-lg flex flex-col border border-surface-container/30">
              <span className="font-label-sm text-label-sm text-on-surface-variant">Sueño / Noche</span>
              <span className="font-metric-md text-metric-md text-on-surface font-bold">7h 45m</span>
              <span className="font-code-data text-code-data text-primary font-medium">86/100 Q-Score</span>
            </div>
            <div className="bg-surface-container-low p-space-sm rounded-lg flex flex-col border border-surface-container/30">
              <span className="font-label-sm text-label-sm text-on-surface-variant">DOMS Score</span>
              <span className="font-metric-md text-metric-md text-on-surface font-bold">2.2 / 5</span>
              <span className="font-code-data text-code-data text-on-surface-variant font-medium">Tolerable</span>
            </div>
          </div>

          <div className="flex flex-col gap-space-xs">
            <div className="flex justify-between items-center text-on-surface-variant font-label-sm text-label-sm">
              <span>Tendencia RPE vs Recuperación (Semana 1 a 4)</span>
              <span className="font-code-data text-code-data text-primary">Fatiga Acumulada: Moderada</span>
            </div>
            <div className="h-28 w-full bg-surface-container-low rounded-lg p-2 flex items-end justify-between gap-2 border border-surface-container/30">
              <div className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <div className="w-full bg-secondary-fixed-dim rounded-t h-[40%]" />
                <span className="font-code-data text-code-data text-on-surface-variant">S1</span>
              </div>
              <div className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <div className="w-full bg-secondary-fixed-dim rounded-t h-[55%]" />
                <span className="font-code-data text-code-data text-on-surface-variant">S2</span>
              </div>
              <div className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <div className="w-full bg-primary-fixed-dim rounded-t h-[70%]" />
                <span className="font-code-data text-code-data text-on-surface-variant">S3</span>
              </div>
              <div className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                <div className="w-full bg-primary rounded-t h-[82%]" />
                <span className="font-code-data text-code-data text-primary font-bold">S4</span>
              </div>
            </div>
          </div>

          <div className="p-space-md bg-secondary-container rounded-xl flex items-start gap-space-sm text-on-secondary-container">
            <span className="material-symbols-outlined text-primary shrink-0 mt-0.5">event_upcoming</span>
            <div className="flex flex-col gap-0.5">
              <span className="font-label-md text-label-md font-semibold text-on-surface">
                Ventana de Descarga Programada
              </span>
              <p className="font-body-md text-body-md text-on-surface-variant text-xs">
                Recomendada en <strong>2 semanas</strong> (Semana 6 del mesociclo). Resensibilización neural y disipación de fatiga articular antes del bloque de fuerza pura.
              </p>
            </div>
          </div>

          <button
            onClick={() => showToast('Abriendo parámetros de descarga y desensibilización')}
            className="w-full py-2 bg-surface-container-lowest hover:bg-surface-container border border-outline-variant/40 text-on-surface font-label-md text-label-md rounded-lg shadow-xs transition-colors flex items-center justify-center gap-space-xs cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined text-base text-primary">edit_calendar</span>
            <span>Ajustar Parámetros de Descarga</span>
          </button>
        </div>
      </div>

      {/* 5. Matriz de Récords Personales Recientes */}
      <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pb-1 border-b border-surface-container/40">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-xl">emoji_events</span>
            <h2 className="font-headline-md text-headline-md text-on-surface font-semibold tracking-tight">
              Hitos y Récords Personales del Mesociclo Activo
            </h2>
          </div>
          <span className="font-code-data text-code-data text-on-surface-variant">
            Registrados mediante validación de RPE en vivo
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-label-sm uppercase tracking-wider">
                <th className="py-2.5 px-space-md rounded-l-lg">Fecha</th>
                <th className="py-2.5 px-space-md">Ejercicio</th>
                <th className="py-2.5 px-space-md text-right">Carga Lograda</th>
                <th className="py-2.5 px-space-md text-right">Repeticiones</th>
                <th className="py-2.5 px-space-md text-center">RIR / RPE</th>
                <th className="py-2.5 px-space-md text-right">1RM Calculado</th>
                <th className="py-2.5 px-space-md rounded-r-lg text-right">Mejora Neta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container font-body-md text-body-md text-on-surface">
              <tr className="hover:bg-surface-container-low transition-colors">
                <td className="py-3 px-space-md font-code-data text-code-data text-on-surface-variant">22 Oct 2024</td>
                <td className="py-3 px-space-md font-semibold flex items-center gap-space-xs">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  Sentadilla con Barra Trasera
                </td>
                <td className="py-3 px-space-md text-right font-code-data font-bold">110.0 kg</td>
                <td className="py-3 px-space-md text-right font-code-data">7 reps</td>
                <td className="py-3 px-space-md text-center">
                  <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface font-code-data text-code-data font-medium">
                    RIR 1 (RPE 9)
                  </span>
                </td>
                <td className="py-3 px-space-md text-right font-code-data font-semibold text-primary">135.0 kg</td>
                <td className="py-3 px-space-md text-right font-code-data font-bold text-primary">+5.0 kg (+3.8%)</td>
              </tr>
              <tr className="hover:bg-surface-container-low transition-colors">
                <td className="py-3 px-space-md font-code-data text-code-data text-on-surface-variant">20 Oct 2024</td>
                <td className="py-3 px-space-md font-semibold flex items-center gap-space-xs">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  Press de Banca Plano
                </td>
                <td className="py-3 px-space-md text-right font-code-data font-bold">85.0 kg</td>
                <td className="py-3 px-space-md text-right font-code-data">8 reps</td>
                <td className="py-3 px-space-md text-center">
                  <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface font-code-data text-code-data font-medium">
                    RIR 1 (RPE 9)
                  </span>
                </td>
                <td className="py-3 px-space-md text-right font-code-data font-semibold text-primary">107.5 kg</td>
                <td className="py-3 px-space-md text-right font-code-data font-bold text-primary">+2.5 kg (+2.4%)</td>
              </tr>
              <tr className="hover:bg-surface-container-low transition-colors">
                <td className="py-3 px-space-md font-code-data text-code-data text-on-surface-variant">17 Oct 2024</td>
                <td className="py-3 px-space-md font-semibold flex items-center gap-space-xs">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  Remo Pendlay con Barra
                </td>
                <td className="py-3 px-space-md text-right font-code-data font-bold">75.0 kg</td>
                <td className="py-3 px-space-md text-right font-code-data">8 reps</td>
                <td className="py-3 px-space-md text-center">
                  <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface font-code-data text-code-data font-medium">
                    RIR 2 (RPE 8)
                  </span>
                </td>
                <td className="py-3 px-space-md text-right font-code-data font-semibold text-primary">95.0 kg</td>
                <td className="py-3 px-space-md text-right font-code-data font-bold text-primary">+2.5 kg (+2.7%)</td>
              </tr>
              <tr className="hover:bg-surface-container-low transition-colors">
                <td className="py-3 px-space-md font-code-data text-code-data text-on-surface-variant">15 Oct 2024</td>
                <td className="py-3 px-space-md font-semibold flex items-center gap-space-xs">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                  Peso Muerto Convencional
                </td>
                <td className="py-3 px-space-md text-right font-code-data font-bold">130.0 kg</td>
                <td className="py-3 px-space-md text-right font-code-data">6 reps</td>
                <td className="py-3 px-space-md text-center">
                  <span className="px-2 py-0.5 rounded-full bg-surface-container text-on-surface font-code-data text-code-data font-medium">
                    RIR 1 (RPE 9)
                  </span>
                </td>
                <td className="py-3 px-space-md text-right font-code-data font-semibold text-primary">155.0 kg</td>
                <td className="py-3 px-space-md text-right font-code-data font-bold text-primary">+5.0 kg (+3.3%)</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-space-xs text-on-surface-variant font-label-sm text-label-sm">
          <span>Mostrando 4 de 19 registros de récords en los últimos 60 días</span>
          <button
            onClick={() => showToast('Histórico completo de 19 récords disponible')}
            className="text-primary hover:text-primary-container font-semibold transition-colors flex items-center gap-1 cursor-pointer"
            type="button"
          >
            <span>Ver histórico completo de PRs</span>
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </button>
        </div>
      </div>
    </div>
  );
};
