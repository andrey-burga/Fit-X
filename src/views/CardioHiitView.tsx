import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';

interface CardioProtocol {
  id: string;
  title: string;
  type: 'z2' | 'hiit';
  badge: string;
  icon: string;
  desc: string;
  duration: string;
  durationMinutes: number;
  intensity: string;
  targetHr: string;
  defaultAvgHr: number;
  defaultMaxHr: number;
  defaultZone2Minutes: number;
  defaultCalories: number;
}

const PROTOCOLS: CardioProtocol[] = [
  {
    id: 'p1',
    title: 'Caminadora Inclinada Z2',
    type: 'z2',
    badge: 'Bajo impacto',
    icon: 'directions_walk',
    desc: 'Trabajo aeróbico sostenido en Zona 2 para capacidad oxidativa sin impacto articular excesivo.',
    duration: '45 min continuos',
    durationMinutes: 45,
    intensity: '12% inclinación · 4.8 km/h',
    targetHr: '125 - 140 bpm',
    defaultAvgHr: 134,
    defaultMaxHr: 140,
    defaultZone2Minutes: 42,
    defaultCalories: 360,
  },
  {
    id: 'p2',
    title: 'HIIT Bicicleta de Aire (SIT)',
    type: 'hiit',
    badge: 'Alta intensidad',
    icon: 'pedal_bike',
    desc: 'Intervalos cortos de sprint con recuperación amplia para estímulo anaeróbico puntual.',
    duration: '10 rondas (20s / 40s)',
    durationMinutes: 20,
    intensity: 'Esfuerzo máximo en sprints',
    targetHr: '168 - 184 bpm (Z5)',
    defaultAvgHr: 158,
    defaultMaxHr: 179,
    defaultZone2Minutes: 4,
    defaultCalories: 240,
  },
  {
    id: 'p3',
    title: 'Remo Ergómetro Zona 2',
    type: 'z2',
    badge: 'Cuerpo completo',
    icon: 'rowing',
    desc: 'Resistencia aeróbica continua de bajo impacto articular en tobillo y rodilla.',
    duration: '30 min continuos',
    durationMinutes: 30,
    intensity: 'Ritmo constante · 22 ppm',
    targetHr: '126 - 138 bpm (Z2)',
    defaultAvgHr: 131,
    defaultMaxHr: 138,
    defaultZone2Minutes: 27,
    defaultCalories: 275,
  },
  {
    id: 'p4',
    title: 'Sprints en Pista 100 m',
    type: 'hiit',
    badge: 'Potencia anaeróbica',
    icon: 'sprint',
    desc: 'Series breves de aceleración con pausa completa entre repeticiones.',
    duration: '6 series × 100 m',
    durationMinutes: 25,
    intensity: '90s descanso entre series',
    targetHr: 'Esfuerzo submáximo',
    defaultAvgHr: 149,
    defaultMaxHr: 176,
    defaultZone2Minutes: 6,
    defaultCalories: 220,
  },
];

export const CardioHiitView: React.FC = () => {
  const { showToast, cardioSessions, addCardioSession, biometrics } = useApp();
  const [activeProtocolFilter, setActiveProtocolFilter] = useState<'all' | 'z2' | 'hiit'>('all');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'z2' | 'hiit'>('all');
  const [showZoneConfig, setShowZoneConfig] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);

  // Karvonen inputs anchored on athlete age
  const [restingHr, setRestingHr] = useState<number>(56);
  const maxHr = Math.max(150, Math.round(208 - 0.7 * (biometrics.age || 30)));
  const hrReserve = Math.max(60, maxHr - restingHr);

  const zones = useMemo(() => {
    const calcRange = (lowPct: number, highPct: number) => ({
      min: Math.round(restingHr + hrReserve * lowPct),
      max: Math.round(restingHr + hrReserve * highPct),
    });
    return {
      z1: { ...calcRange(0.5, 0.6), label: 'Z1 · Recuperación', pct: '50 - 60%', desc: 'Movilidad aeróbica ligera y recuperación activa.' },
      z2: { ...calcRange(0.6, 0.72), label: 'Z2 · Base Aeróbica', pct: '60 - 72%', desc: 'Base aeróbica sostenible compatible con bloques de fuerza.' },
      z3: { ...calcRange(0.72, 0.82), label: 'Z3 · Tempo', pct: '72 - 82%', desc: 'Esfuerzo aeróbico moderado-alto.' },
      z4: { ...calcRange(0.82, 0.9), label: 'Z4 · Umbral', pct: '82 - 90%', desc: 'Trabajo sostenido cercano al umbral anaeróbico.' },
      z5: { ...calcRange(0.9, 1.0), label: 'Z5 · Máximo', pct: '90 - 100%', desc: 'Intervalos breves de alta intensidad (HIIT / SIT).' },
    };
  }, [restingHr, hrReserve]);

  // Manual cardio entry state
  const [formTitle, setFormTitle] = useState('Caminadora Inclinada Z2');
  const [formDetails, setFormDetails] = useState('12% inclinación · 4.8 km/h');
  const [formDuration, setFormDuration] = useState<number>(45);
  const [formAvgHr, setFormAvgHr] = useState<number>(134);
  const [formMaxHr, setFormMaxHr] = useState<number>(140);
  const [formZone2Min, setFormZone2Min] = useState<number>(42);
  const [formCalories, setFormCalories] = useState<number>(360);
  const [isSaving, setIsSaving] = useState(false);

  const metrics = useMemo(() => {
    const totalZone2Min = cardioSessions.reduce((acc, s) => acc + (s.zone2Minutes || 0), 0);
    const totalCalories = cardioSessions.reduce((acc, s) => acc + (s.caloriesBurned || 0), 0);
    const totalMinutes = cardioSessions.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);
    const hiitCount = cardioSessions.filter(s => s.zone2Percentage === 0 || s.title.toLowerCase().includes('hiit') || s.title.toLowerCase().includes('sprint')).length;
    const z2Goal = 150;
    const z2ProgressPct = Math.min(100, Math.round((totalZone2Min / z2Goal) * 100));

    return {
      totalZone2Min: Math.round(totalZone2Min),
      z2Goal,
      z2ProgressPct,
      hiitCount,
      totalCalories: Math.round(totalCalories),
      totalMinutes: Math.round(totalMinutes),
      sessionsCount: cardioSessions.length,
    };
  }, [cardioSessions]);

  const filteredProtocols = PROTOCOLS.filter(p => {
    if (activeProtocolFilter === 'all') return true;
    return p.type === activeProtocolFilter;
  });

  const filteredHistory = useMemo(() => {
    return cardioSessions.filter(s => {
      if (historyFilter === 'all') return true;
      const isHiit = s.zone2Percentage === 0 || s.title.toLowerCase().includes('hiit') || s.title.toLowerCase().includes('sprint');
      return historyFilter === 'hiit' ? isHiit : !isHiit;
    });
  }, [cardioSessions, historyFilter]);

  const handleLoadProtocol = (protocol: CardioProtocol) => {
    setFormTitle(protocol.title);
    setFormDetails(protocol.intensity);
    setFormDuration(protocol.durationMinutes);
    setFormAvgHr(protocol.defaultAvgHr);
    setFormMaxHr(protocol.defaultMaxHr);
    setFormZone2Min(protocol.defaultZone2Minutes);
    setFormCalories(protocol.defaultCalories);
    setShowManualForm(true);
    showToast(`Protocolo cargado en el formulario: ${protocol.title}`);
  };

  const handleSaveManualSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || formDuration <= 0) {
      showToast('Ingresa un nombre y duración válidos para la sesión', 'warning');
      return;
    }
    setIsSaving(true);
    try {
      const z2Pct = formDuration > 0 ? Math.min(100, Math.round((formZone2Min / formDuration) * 100)) : 0;
      await addCardioSession({
        date: 'Hoy, ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
        title: formTitle.trim(),
        details: formDetails.trim() || 'Registro manual',
        durationMinutes: Number(formDuration),
        avgHr: Number(formAvgHr),
        maxHr: Number(formMaxHr),
        zone2Minutes: Number(formZone2Min),
        zone2Percentage: z2Pct,
        caloriesBurned: Number(formCalories),
        device: 'Registro manual',
      });
      setShowManualForm(false);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-gutter-desktop max-w-[1440px] mx-auto w-full flex flex-col gap-space-xl animate-in fade-in duration-150">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-space-lg">
        <div className="space-y-space-xs max-w-3xl">
          <div className="flex flex-wrap items-center gap-space-sm mb-space-xs">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-fixed/30 text-on-primary-fixed-variant font-label-sm text-label-sm uppercase tracking-wider font-semibold">
              Zona 2 y Acondicionamiento · Z1–Z5
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-low text-on-surface-variant font-label-sm text-label-sm">
              <span className="material-symbols-outlined text-sm text-primary">edit_note</span>
              <span>Registro manual (sin sensor conectado)</span>
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface font-bold tracking-tight">
            Cardio, Resistencia y Protocolos HIIT
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            Planificación de zonas de frecuencia cardíaca (Z1–Z5), control de volumen aeróbico semanal y registro manual de sesiones cardiovasculares.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-space-sm shrink-0">
          <button
            onClick={() => setShowZoneConfig(prev => !prev)}
            className="flex items-center gap-1.5 px-space-md py-2 rounded-lg bg-surface-container-lowest text-on-surface shadow-xs hover:bg-surface-container transition-colors font-label-md text-label-md font-medium cursor-pointer border border-surface-container/60"
            type="button"
          >
            <span className="material-symbols-outlined text-base text-secondary">tune</span>
            <span>{showZoneConfig ? 'Ocultar Zonas FC' : 'Configurar Zonas FC'}</span>
          </button>
          <button
            onClick={() => setShowManualForm(prev => !prev)}
            className="flex items-center gap-1.5 px-space-md py-2 rounded-lg bg-primary hover:bg-primary-container text-on-primary shadow-sm transition-all font-label-md text-label-md font-medium cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined text-base">{showManualForm ? 'close' : 'add'}</span>
            <span>{showManualForm ? 'Cerrar formulario' : 'Registrar sesión'}</span>
          </button>
        </div>
      </div>

      {/* Interactive Karvonen Zone Configurator */}
      {showZoneConfig && (
        <section className="bg-surface-container-low rounded-xl p-space-md border border-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-space-md">
          <div className="flex flex-col gap-1">
            <h2 className="font-headline-sm text-sm font-bold text-on-surface">
              Ajuste de Zonas por Fórmula de Karvonen
            </h2>
            <p className="text-xs text-on-surface-variant">
              Edad tomada de tu perfil biométrico ({biometrics.age || 30} años · FC Máx estimada: {maxHr} bpm). Ajusta tu FC en reposo:
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label htmlFor="resting-hr-input" className="text-xs font-semibold text-on-surface">
              FC Reposo (bpm):
            </label>
            <input
              id="resting-hr-input"
              type="number"
              min={35}
              max={100}
              value={restingHr}
              onChange={e => setRestingHr(Math.max(35, Math.min(100, Number(e.target.value) || 56)))}
              className="w-20 px-2.5 py-1.5 rounded-lg bg-surface-container-lowest border border-outline-variant text-sm font-mono font-bold text-on-surface"
            />
          </div>
        </section>
      )}

      {/* Manual Cardio Session Logger */}
      {showManualForm && (
        <form
          onSubmit={handleSaveManualSession}
          className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-primary/25 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md"
        >
          <div className="sm:col-span-2 lg:col-span-4 flex items-center justify-between border-b border-surface-container/60 pb-2">
            <h2 className="font-headline-sm text-base font-bold text-on-surface">
              Registrar Sesión Cardiovascular
            </h2>
            <span className="text-xs text-on-surface-variant">Se guarda en tu historial de cardio</span>
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-on-surface-variant">Modalidad / Título</span>
            <input
              type="text"
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              className="px-3 py-2 rounded-lg bg-surface-container-low border border-surface-container text-sm text-on-surface"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-on-surface-variant">Detalles de intensidad</span>
            <input
              type="text"
              value={formDetails}
              onChange={e => setFormDetails(e.target.value)}
              className="px-3 py-2 rounded-lg bg-surface-container-low border border-surface-container text-sm text-on-surface"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-on-surface-variant">Duración (min)</span>
            <input
              type="number"
              min={1}
              max={300}
              value={formDuration}
              onChange={e => setFormDuration(Number(e.target.value) || 0)}
              className="px-3 py-2 rounded-lg bg-surface-container-low border border-surface-container text-sm font-mono text-on-surface"
              required
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-on-surface-variant">Minutos en Zona 2</span>
            <input
              type="number"
              min={0}
              max={300}
              value={formZone2Min}
              onChange={e => setFormZone2Min(Number(e.target.value) || 0)}
              className="px-3 py-2 rounded-lg bg-surface-container-low border border-surface-container text-sm font-mono text-on-surface"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-on-surface-variant">FC Media (bpm)</span>
            <input
              type="number"
              min={60}
              max={220}
              value={formAvgHr}
              onChange={e => setFormAvgHr(Number(e.target.value) || 0)}
              className="px-3 py-2 rounded-lg bg-surface-container-low border border-surface-container text-sm font-mono text-on-surface"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-on-surface-variant">FC Pico (bpm)</span>
            <input
              type="number"
              min={60}
              max={230}
              value={formMaxHr}
              onChange={e => setFormMaxHr(Number(e.target.value) || 0)}
              className="px-3 py-2 rounded-lg bg-surface-container-low border border-surface-container text-sm font-mono text-on-surface"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-semibold text-on-surface-variant">Gasto estimado (kcal)</span>
            <input
              type="number"
              min={0}
              max={3000}
              value={formCalories}
              onChange={e => setFormCalories(Number(e.target.value) || 0)}
              className="px-3 py-2 rounded-lg bg-surface-container-low border border-surface-container text-sm font-mono text-on-surface"
            />
          </label>

          <div className="flex items-end gap-2">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full py-2 px-4 rounded-lg bg-primary hover:bg-primary-container text-on-primary text-xs font-semibold cursor-pointer disabled:opacity-60"
            >
              {isSaving ? 'Guardando...' : 'Guardar sesión'}
            </button>
          </div>
        </form>
      )}

      {/* Section 1: Grounded KPI Banners computed from cardioSessions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-space-xs">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Minutos Zona 2 Registrados
              </span>
              <span className="material-symbols-outlined text-primary text-lg">ecg_heart</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-metric-xl text-metric-xl text-on-surface font-bold tracking-tight tabular-nums">
                {metrics.totalZone2Min}
              </span>
              <span className="font-headline-sm text-headline-sm text-on-surface-variant font-medium tabular-nums">
                / {metrics.z2Goal} min
              </span>
            </div>
          </div>
          <div className="mt-space-md space-y-1.5">
            <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden">
              <div className="bg-primary h-full rounded-full transition-all duration-300" style={{ width: `${metrics.z2ProgressPct}%` }} />
            </div>
            <div className="flex justify-between items-center text-on-surface-variant font-label-sm text-label-sm">
              <span>{metrics.z2ProgressPct}% de meta semanal</span>
              <span className="font-semibold text-primary tabular-nums">
                {Math.max(0, metrics.z2Goal - metrics.totalZone2Min)} min rest.
              </span>
            </div>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-space-xs">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Sesiones HIIT Registradas
              </span>
              <span className="material-symbols-outlined text-tertiary text-lg">bolt</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-metric-xl text-metric-xl text-on-surface font-bold tracking-tight tabular-nums">
                {metrics.hiitCount}
              </span>
              <span className="font-headline-sm text-headline-sm text-on-surface-variant font-medium">sesiones</span>
            </div>
          </div>
          <p className="font-label-sm text-label-sm text-on-surface-variant mt-space-md">
            Conteo directo sobre tu historial guardado.
          </p>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-space-xs">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Gasto Aeróbico Acumulado
              </span>
              <span className="material-symbols-outlined text-secondary text-lg">local_fire_department</span>
            </div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="font-metric-xl text-metric-xl text-on-surface font-bold tracking-tight tabular-nums">
                {metrics.totalCalories.toLocaleString()}
              </span>
              <span className="font-label-md text-label-md text-on-surface-variant font-medium">kcal</span>
            </div>
          </div>
          <div className="mt-space-md flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm bg-surface-container-low px-2 py-1 rounded border border-surface-container/40">
            <span>Sesiones registradas</span>
            <span className="text-on-surface font-semibold tabular-nums">{metrics.sessionsCount}</span>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-space-xs">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Volumen Total Registrado
              </span>
              <span className="material-symbols-outlined text-primary text-lg">schedule</span>
            </div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="font-metric-xl text-metric-xl text-on-surface font-bold tracking-tight tabular-nums">
                {metrics.totalMinutes}
              </span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">min totales</span>
            </div>
          </div>
          <div className="mt-space-md flex items-center justify-between font-label-sm text-label-sm">
            <span className="text-on-surface-variant">FC Máx estimada</span>
            <span className="text-primary font-bold tabular-nums">{maxHr} bpm</span>
          </div>
        </div>
      </div>

      {/* Section 2: Heart Rate Zones Map */}
      <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 space-y-space-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-sm pb-2 border-b border-surface-container/40">
          <div>
            <div className="flex items-center gap-space-xs text-xs text-on-surface-variant">
              <span className="font-semibold text-primary uppercase tracking-wider">Referencia Karvonen</span>
              <span aria-hidden="true">/</span>
              <span>Edad {biometrics.age || 30} años</span>
            </div>
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold tracking-tight mt-0.5">
              Zonas de Frecuencia Cardíaca (Z1–Z5)
            </h2>
          </div>

          <div className="flex items-center gap-space-md bg-surface-container-low px-space-md py-1.5 rounded-lg border border-surface-container/40">
            <div className="flex items-center gap-1.5">
              <span className="font-label-sm text-label-sm text-on-surface-variant">FC Reposo:</span>
              <span className="font-headline-sm text-headline-sm text-on-surface font-bold tabular-nums">{restingHr}</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">bpm</span>
            </div>
            <span className="text-outline-variant">|</span>
            <div className="flex items-center gap-1.5">
              <span className="font-label-sm text-label-sm text-on-surface-variant">FC Máx:</span>
              <span className="font-headline-sm text-headline-sm text-on-surface font-bold tabular-nums">{maxHr}</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">bpm</span>
            </div>
            <span className="text-outline-variant">|</span>
            <div className="flex items-center gap-1.5">
              <span className="font-label-sm text-label-sm text-on-surface-variant">Zona 2:</span>
              <span className="font-headline-sm text-headline-sm text-primary font-bold tabular-nums">
                {zones.z2.min}–{zones.z2.max}
              </span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">bpm</span>
            </div>
          </div>
        </div>

        {/* 5-Zone Continuous Progress Bar */}
        <div className="w-full flex h-3 rounded-full overflow-hidden">
          <div className="bg-surface-container-highest" style={{ width: '20%' }} title={`Z1: ${zones.z1.min}-${zones.z1.max} bpm`} />
          <div className="bg-primary ring-2 ring-surface-container-lowest" style={{ width: '30%' }} title={`Z2: ${zones.z2.min}-${zones.z2.max} bpm`} />
          <div className="bg-secondary-fixed" style={{ width: '20%' }} title={`Z3: ${zones.z3.min}-${zones.z3.max} bpm`} />
          <div className="bg-tertiary" style={{ width: '15%' }} title={`Z4: ${zones.z4.min}-${zones.z4.max} bpm`} />
          <div className="bg-error" style={{ width: '15%' }} title={`Z5: ${zones.z5.min}-${zones.z5.max} bpm`} />
        </div>

        {/* Zone Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-space-sm pt-space-xs">
          {[zones.z1, zones.z2, zones.z3, zones.z4, zones.z5].map((z, i) => {
            const isZ2 = i === 1;
            const isZ5 = i === 4;
            return (
              <div
                key={z.label}
                className={`p-space-sm rounded-lg flex flex-col justify-between space-y-2 ${
                  isZ2
                    ? 'bg-primary/10 ring-1 ring-primary/40'
                    : 'bg-surface-container-low border border-surface-container/30'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className={`font-label-sm text-label-sm font-bold ${isZ2 ? 'text-primary' : isZ5 ? 'text-error' : 'text-on-surface'}`}>
                      {z.label}
                    </span>
                    <span className={`font-code-data text-code-data tabular-nums ${isZ2 ? 'font-bold text-primary' : 'text-on-surface-variant'}`}>
                      {z.pct}
                    </span>
                  </div>
                  <p className={`font-headline-sm text-headline-sm font-bold mt-1 tabular-nums ${isZ2 ? 'text-primary' : 'text-on-surface'}`}>
                    {z.min} - {z.max} <span className="text-xs font-normal text-on-surface-variant">bpm</span>
                  </p>
                  <p className="font-label-sm text-label-sm text-on-surface-variant mt-1 text-xs">
                    {z.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 3: Protocols */}
      <div className="space-y-space-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
          <div>
            <h2 className="font-headline-md text-headline-md text-on-surface font-bold tracking-tight">
              Protocolos Aeróbicos y HIIT
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Selecciona una plantilla para cargarla en el formulario y registrar tu sesión real.
            </p>
          </div>

          <div className="flex items-center gap-space-xs bg-surface-container-lowest p-1 rounded-lg shadow-xs border border-surface-container/40">
            {[
              { id: 'all', label: 'Todos' },
              { id: 'z2', label: 'Zona 2' },
              { id: 'hiit', label: 'HIIT' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveProtocolFilter(tab.id as 'all' | 'z2' | 'hiit')}
                className={`px-3 py-1 rounded font-label-md text-label-md transition-colors cursor-pointer ${
                  activeProtocolFilter === tab.id
                    ? 'bg-surface-container text-on-surface font-semibold shadow-xs'
                    : 'text-on-surface-variant hover:text-on-surface'
                }`}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-space-md">
          {filteredProtocols.map(p => (
            <div
              key={p.id}
              className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between hover:shadow-md transition-shadow"
            >
              <div className="space-y-space-xs">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-fixed/40 text-on-primary-fixed-variant font-label-sm text-label-sm font-semibold">
                    {p.badge}
                  </span>
                  <span className="material-symbols-outlined text-secondary text-lg">{p.icon}</span>
                </div>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold mt-2">
                  {p.title}
                </h3>
                <p className="font-label-sm text-label-sm text-on-surface-variant text-xs">
                  {p.desc}
                </p>

                <div className="pt-space-xs space-y-1.5 text-on-surface font-label-md text-label-md text-xs">
                  <div className="flex justify-between py-1 bg-surface-container-low px-2 rounded border border-surface-container/30">
                    <span className="text-on-surface-variant">Duración:</span>
                    <span className="font-semibold">{p.duration}</span>
                  </div>
                  <div className="flex justify-between py-1 bg-surface-container-low px-2 rounded border border-surface-container/30">
                    <span className="text-on-surface-variant">Intensidad:</span>
                    <span className="font-semibold">{p.intensity}</span>
                  </div>
                  <div className="flex justify-between py-1 bg-surface-container-low px-2 rounded border border-surface-container/30">
                    <span className="text-on-surface-variant">FC Objetivo:</span>
                    <span className="font-semibold text-primary">{p.targetHr}</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => handleLoadProtocol(p)}
                className="mt-space-md w-full py-2 bg-surface-container-low hover:bg-primary hover:text-on-primary text-on-surface rounded-lg font-label-md text-label-md font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer border border-surface-container/40"
                type="button"
              >
                <span className="material-symbols-outlined text-sm">edit_note</span>
                <span>Cargar en registro</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Section 4: Cardio Session History Table */}
      <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 space-y-space-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pb-1 border-b border-surface-container/30">
          <div>
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold tracking-tight">
              Historial de Sesiones Cardiovasculares
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Sesiones registradas manualmente en tu cuenta.
            </p>
          </div>
          <div className="flex items-center gap-space-xs">
            <label htmlFor="cardio-history-filter" className="font-label-sm text-label-sm text-on-surface-variant">
              Filtrar:
            </label>
            <select
              id="cardio-history-filter"
              value={historyFilter}
              onChange={e => setHistoryFilter(e.target.value as 'all' | 'z2' | 'hiit')}
              className="bg-surface-container-low text-on-surface font-label-sm text-label-sm py-1.5 px-3 rounded-lg border border-surface-container focus:ring-1 focus:ring-primary cursor-pointer"
            >
              <option value="all">Todas las sesiones</option>
              <option value="z2">Solo Zona 2</option>
              <option value="hiit">Solo HIIT / Sprint</option>
            </select>
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <div className="p-8 text-center text-sm text-on-surface-variant bg-surface-container-low rounded-xl border border-dashed border-outline-variant">
            No hay sesiones registradas para este filtro. Usa el botón &quot;Registrar sesión&quot; para añadir una.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low text-on-surface-variant font-label-sm text-label-sm uppercase tracking-wider">
                  <th className="py-2.5 px-3 rounded-l-lg">Fecha / Modalidad</th>
                  <th className="py-2.5 px-3">Duración</th>
                  <th className="py-2.5 px-3">FC Media</th>
                  <th className="py-2.5 px-3">FC Pico</th>
                  <th className="py-2.5 px-3">Tiempo en Zona 2</th>
                  <th className="py-2.5 px-3">Gasto Neto</th>
                  <th className="py-2.5 px-3 text-right rounded-r-lg">Origen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container font-body-md text-body-md text-on-surface">
                {filteredHistory.map(session => (
                  <tr key={session.id} className="hover:bg-surface-container-low/40 transition-colors">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary text-lg">
                          {session.title.includes('Caminadora')
                            ? 'directions_walk'
                            : session.title.includes('Bike') || session.title.includes('Bicicleta')
                            ? 'pedal_bike'
                            : 'rowing'}
                        </span>
                        <div>
                          <p className="font-semibold text-on-surface">{session.title}</p>
                          <p className="font-label-sm text-label-sm text-on-surface-variant">
                            {session.date} · {session.details}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-code-data font-medium tabular-nums">{session.durationMinutes} min</td>
                    <td className="py-3 px-3">
                      <span className="font-code-data font-semibold text-primary tabular-nums">{session.avgHr} bpm</span>
                    </td>
                    <td className="py-3 px-3 font-code-data text-on-surface-variant tabular-nums">{session.maxHr} bpm</td>
                    <td className="py-3 px-3">
                      {session.zone2Percentage > 0 ? (
                        <div className="flex items-center gap-2">
                          <span className="font-code-data font-semibold tabular-nums">{session.zone2Minutes} min</span>
                          <span className="text-xs text-primary font-medium tabular-nums">({session.zone2Percentage}%)</span>
                        </div>
                      ) : (
                        <span className="font-code-data text-on-surface-variant">N/A (HIIT)</span>
                      )}
                    </td>
                    <td className="py-3 px-3 font-code-data font-semibold tabular-nums">{session.caloriesBurned} kcal</td>
                    <td className="py-3 px-3 text-right">
                      <span className="inline-flex items-center px-2 py-0.5 rounded bg-surface-container text-on-surface-variant text-xs font-medium">
                        {session.device || 'Registro manual'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
