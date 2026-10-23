import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export const CardioHiitView: React.FC = () => {
  const { showToast, cardioSessions, addCardioSession } = useApp();
  const [activeProtocolFilter, setActiveProtocolFilter] = useState<'all' | 'z2' | 'hiit'>('all');

  const handleStartCardio = async () => {
    await addCardioSession({
      date: 'Hoy, ' + new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      title: 'Caminadora Inclinada Z2',
      details: '12% inclinación @ 4.8 km/h • Sensor Polar H10',
      durationMinutes: 45,
      avgHr: 134,
      maxHr: 140,
      zone2Minutes: 42.0,
      zone2Percentage: 93,
      caloriesBurned: 380,
      device: 'Polar H10',
    });
  };

  const protocols = [
    {
      id: 'p1',
      title: 'Caminadora Inclinada Z2 (Incline Walk)',
      type: 'z2',
      badge: 'Cero Interferencia',
      icon: 'directions_walk',
      desc: 'Máxima tasa de oxidación de ácidos grasos sin impacto articular ni fatiga del tendón rotuliano.',
      duration: '45 min continuos',
      intensity: '12% • 4.8 km/h',
      targetHr: '130 - 138 bpm',
    },
    {
      id: 'p2',
      title: 'HIIT Assault Bike (SIT Protocol)',
      type: 'hiit',
      badge: 'EPOC Elevado / Sensibilidad',
      icon: 'pedal_bike',
      desc: 'Sprint Interval Training: estimulación máxima de GLUT4 y aumento exponencial de EPOC post-ejercicio.',
      duration: '10 Rondas (20s sprint / 40s Z1)',
      intensity: '> 500 Watts (Max Effort)',
      targetHr: '175 - 184 bpm (Z5)',
    },
    {
      id: 'p3',
      title: 'Remo Indoor Concept2 Zona 2',
      type: 'z2',
      badge: 'Reclutamiento 85% Masa',
      icon: 'rowing',
      desc: 'Trabajo de tracción posterior y resistencia cardiovascular de bajo impacto en rodilla y tobillo.',
      duration: '30 min continuos',
      intensity: '2:08/500m • 22 spm',
      targetHr: '128 - 136 bpm (Z2)',
    },
    {
      id: 'p4',
      title: 'Sprints en Pista 100m (Anaeróbico)',
      type: 'hiit',
      badge: 'Potencia Anaeróbica Pura',
      icon: 'sprint',
      desc: 'Reclutamiento de unidades motoras rápidas Tipo IIb con resíntesis total de fosfocreatina.',
      duration: '6 series x 100m (95% vel)',
      intensity: '90s recuperación pasiva',
      targetHr: 'Zancada circular reactiva',
    },
  ];

  const filteredProtocols = protocols.filter(p => {
    if (activeProtocolFilter === 'all') return true;
    return p.type === activeProtocolFilter;
  });

  return (
    <div className="p-4 sm:p-gutter-desktop max-w-[1440px] mx-auto w-full flex flex-col gap-space-xl animate-in fade-in duration-150">
      {/* Header & Device Telemetry Status */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-space-lg">
        <div className="space-y-space-xs max-w-3xl">
          <div className="flex flex-wrap items-center gap-space-sm mb-space-xs">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary-fixed/30 text-on-primary-fixed-variant font-label-sm text-label-sm uppercase tracking-wider font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              Zona 2 Prioritaria • Metabolismo de Lípidos
            </span>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container-high text-on-surface font-label-sm text-label-sm">
              <span className="material-symbols-outlined text-sm text-primary">monitor_heart</span>
              <span className="font-medium">Polar H10 Conectado</span>
              <span className="text-outline">·</span>
              <span className="text-primary font-bold">138 bpm</span>
            </div>
            <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-container-low text-secondary font-label-sm text-label-sm">
              <span className="material-symbols-outlined text-xs text-secondary">watch</span>
              <span>Apple Watch Ultra Sincronizado</span>
            </div>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface font-bold tracking-tight">
            Cardio, Resistencia y Protocolos HIIT
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-2xl">
            Planificación estricta de zonas de frecuencia cardíaca (Z1-Z5), control de interferencia neuromuscular con la hipertrofia (mTOR vs. AMPK) y registro telemétrico continuo.
          </p>
        </div>

        <div className="flex items-center flex-wrap gap-space-sm shrink-0">
          <button
            onClick={() => showToast('Configuración de Zonas Karvonen abierta')}
            className="flex items-center gap-1.5 px-space-md py-2 rounded-lg bg-surface-container-lowest text-on-surface shadow-xs hover:bg-surface-container transition-colors font-label-md text-label-md font-medium cursor-pointer border border-surface-container/60"
            type="button"
          >
            <span className="material-symbols-outlined text-base text-secondary">tune</span>
            <span>Configurar Zonas FC</span>
          </button>
          <button
            onClick={handleStartCardio}
            className="flex items-center gap-1.5 px-space-md py-2 rounded-lg bg-primary hover:bg-primary-container text-on-primary shadow-sm transition-all font-label-md text-label-md font-medium cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined text-base">play_arrow</span>
            <span>+ Iniciar Sesión de Cardio</span>
          </button>
        </div>
      </div>

      {/* Section 1: KPI Banners */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-space-md">
        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-space-xs">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Minutos Zona 2 Semanal
              </span>
              <span className="material-symbols-outlined text-primary text-lg">ecg_heart</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-metric-xl text-metric-xl text-on-surface font-bold tracking-tight">135</span>
              <span className="font-headline-sm text-headline-sm text-on-surface-variant font-medium">/ 150 min</span>
            </div>
          </div>
          <div className="mt-space-md space-y-1.5">
            <div className="w-full bg-surface-container-high h-2 rounded-full overflow-hidden">
              <div className="bg-primary h-full rounded-full transition-all duration-500" style={{ width: '90%' }} />
            </div>
            <div className="flex justify-between items-center text-on-surface-variant font-label-sm text-label-sm">
              <span>90% meta biogénesis mitocondrial</span>
              <span className="font-semibold text-primary">Faltan 15 min</span>
            </div>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-space-xs">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Sesiones HIIT Realizadas
              </span>
              <span className="material-symbols-outlined text-tertiary text-lg">bolt</span>
            </div>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="font-metric-xl text-metric-xl text-on-surface font-bold tracking-tight">2</span>
              <span className="font-headline-sm text-headline-sm text-on-surface-variant font-medium">/ 2 sesiones</span>
            </div>
          </div>
          <div className="mt-space-md">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-fixed/40 text-on-primary-fixed-variant font-label-sm text-label-sm font-semibold">
                <span className="material-symbols-outlined text-xs mr-1">check_circle</span> Assault Bike
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary-fixed/40 text-on-primary-fixed-variant font-label-sm text-label-sm font-semibold">
                <span className="material-symbols-outlined text-xs mr-1">check_circle</span> Sprints
              </span>
            </div>
            <p className="font-label-sm text-label-sm text-on-surface-variant mt-1.5">Volumen óptimo sin fatiga del SNC.</p>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-space-xs">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                Gasto Aeróbico Semanal
              </span>
              <span className="material-symbols-outlined text-secondary text-lg">local_fire_department</span>
            </div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="font-metric-xl text-metric-xl text-on-surface font-bold tracking-tight">1,140</span>
              <span className="font-label-md text-label-md text-on-surface-variant font-medium">kcal</span>
            </div>
          </div>
          <div className="mt-space-md flex items-center justify-between text-on-surface-variant font-label-sm text-label-sm bg-surface-container-low px-2 py-1 rounded border border-surface-container/40">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-xs text-primary">verified</span>
              <span>Banda Polar H10</span>
            </span>
            <span className="text-on-surface font-semibold">Neto verificado</span>
          </div>
        </div>

        <div className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-space-xs">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                VO2 Máx Estimado
              </span>
              <span className="material-symbols-outlined text-primary text-lg">trending_up</span>
            </div>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="font-metric-xl text-metric-xl text-on-surface font-bold tracking-tight">51.4</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">ml/kg/min</span>
            </div>
          </div>
          <div className="mt-space-md space-y-1">
            <div className="flex items-center justify-between font-label-sm text-label-sm">
              <span className="px-2 py-0.5 rounded-full bg-primary-fixed/40 text-on-primary-fixed-variant font-semibold">
                Excelente / Sup. (32a)
              </span>
              <span className="text-primary font-bold">+1.2 ml (60d)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 2: mTOR vs AMPK Molecular Interference */}
      <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-space-md pb-space-md border-b border-surface-container/40">
          <div className="flex items-center gap-space-sm">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-primary text-xl">biotech</span>
            </div>
            <div>
              <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold tracking-tight">
                Auditoría de Interferencia Molecular (mTOR vs. AMPK)
              </h2>
              <p className="font-body-md text-body-md text-on-surface-variant">
                Monitoreo biomecánico para evitar la fosforilación competitiva de TSC2 inducida por AMPK durante la hipertrofia.
              </p>
            </div>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary-fixed/30 text-on-primary-fixed-variant font-label-md text-label-md font-semibold shrink-0">
            <span className="material-symbols-outlined text-base text-primary">verified_user</span>
            <span>Ventana Catabólica Neutralizada</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-space-md pt-space-md">
          <div className="bg-surface-container-low p-space-md rounded-lg flex flex-col justify-between border border-surface-container/40">
            <div>
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">
                Última Sesión de Fuerza
              </span>
              <p className="font-body-lg text-body-lg font-bold text-on-surface mt-1">Torso &amp; Brazos Hipertrofia</p>
              <p className="font-label-sm text-label-sm text-on-surface-variant">Finalizada hace 7h 14m</p>
            </div>
            <div className="mt-space-sm">
              <span className="text-xs px-2 py-0.5 rounded bg-surface-container-lowest text-primary font-medium">
                Límite mínimo: 6h cumplido
              </span>
            </div>
          </div>

          <div className="bg-surface-container-low p-space-md rounded-lg flex flex-col justify-between border border-surface-container/40">
            <div>
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">
                Estado de Señalización Muscular
              </span>
              <p className="font-body-lg text-body-lg font-bold text-on-surface mt-1">mTORC1 Fase Meseta</p>
              <p className="font-label-sm text-label-sm text-on-surface-variant">
                Síntesis proteica inicial completada sin bloqueo
              </p>
            </div>
            <div className="mt-space-sm">
              <span className="text-xs px-2 py-0.5 rounded bg-surface-container-lowest text-secondary font-medium">
                Recomendación: HIIT o Z2 Seguro
              </span>
            </div>
          </div>

          <div className="bg-surface-container-low p-space-md rounded-lg flex flex-col justify-between border border-surface-container/40">
            <div>
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">
                Modalidad de Menor Impacto
              </span>
              <p className="font-body-lg text-body-lg font-bold text-on-surface mt-1">Ciclismo Estático / Incline Walk</p>
              <p className="font-label-sm text-label-sm text-on-surface-variant">Nula contracción excéntrica perjudicial</p>
            </div>
            <div className="mt-space-sm">
              <span className="text-xs px-2 py-0.5 rounded bg-surface-container-lowest text-primary font-medium">
                0% Daño miofibrilar adicional
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 3: Heart Rate Zones Map */}
      <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 space-y-space-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-sm pb-2 border-b border-surface-container/40">
          <div>
            <div className="flex items-center gap-space-xs">
              <span className="font-label-sm text-label-sm text-primary font-bold uppercase tracking-wider">
                Bio-parámetros
              </span>
              <span className="text-outline text-xs">/</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase">
                Karvonen &amp; Curva de Lactato
              </span>
            </div>
            <h2 className="font-headline-sm text-headline-sm text-on-surface font-bold tracking-tight mt-0.5">
              Zonas de Entrenamiento Cardiovascular Personalizadas
            </h2>
          </div>

          <div className="flex items-center gap-space-md bg-surface-container-low px-space-md py-1.5 rounded-lg border border-surface-container/40">
            <div className="flex items-center gap-1.5">
              <span className="font-label-sm text-label-sm text-on-surface-variant">FC Reposo:</span>
              <span className="font-headline-sm text-headline-sm text-on-surface font-bold">52</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">bpm</span>
            </div>
            <span className="text-outline-variant">|</span>
            <div className="flex items-center gap-1.5">
              <span className="font-label-sm text-label-sm text-on-surface-variant">FC Máx:</span>
              <span className="font-headline-sm text-headline-sm text-on-surface font-bold">188</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">bpm</span>
            </div>
            <span className="text-outline-variant">|</span>
            <div className="flex items-center gap-1.5">
              <span className="font-label-sm text-label-sm text-on-surface-variant">FatMax:</span>
              <span className="font-headline-sm text-headline-sm text-primary font-bold">134</span>
              <span className="font-label-sm text-label-sm text-on-surface-variant">bpm</span>
            </div>
          </div>
        </div>

        {/* 5-Zone Continuous Progress Bar */}
        <div className="w-full flex h-3 rounded-full overflow-hidden">
          <div className="bg-surface-container-highest transition-all duration-300" style={{ width: '20%' }} title="Zona 1: 95-118 bpm" />
          <div className="bg-primary transition-all duration-300 ring-2 ring-surface-container-lowest" style={{ width: '30%' }} title="Zona 2: 119-142 bpm (Prioritaria)" />
          <div className="bg-secondary-fixed transition-all duration-300" style={{ width: '20%' }} title="Zona 3: 143-156 bpm" />
          <div className="bg-tertiary transition-all duration-300" style={{ width: '15%' }} title="Zona 4: 157-171 bpm" />
          <div className="bg-error transition-all duration-300" style={{ width: '15%' }} title="Zona 5: 172-188 bpm" />
        </div>

        {/* Zone Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-space-sm pt-space-xs">
          <div className="p-space-sm bg-surface-container-low rounded-lg flex flex-col justify-between space-y-2 border border-surface-container/30">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm font-bold text-on-surface">Z1 · Activa</span>
                <span className="font-code-data text-code-data text-on-surface-variant">&lt;60%</span>
              </div>
              <p className="font-headline-sm text-headline-sm text-on-surface font-bold mt-1">
                95 - 118 <span className="text-xs font-normal text-on-surface-variant">bpm</span>
              </p>
              <p className="font-label-sm text-label-sm text-on-surface-variant mt-1 text-xs">
                Oxidación de lactato remanente y capilarización muscular.
              </p>
            </div>
            <div className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-lowest px-2 py-1 rounded">
              Sustrato: Grasas ligeras
            </div>
          </div>

          <div className="p-space-sm bg-primary/10 rounded-lg flex flex-col justify-between space-y-2 ring-1 ring-primary/40">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm font-bold text-primary flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-primary" /> Z2 · Eficiencia
                </span>
                <span className="font-code-data text-code-data font-bold text-primary">60 - 72%</span>
              </div>
              <p className="font-headline-sm text-headline-sm text-primary font-bold mt-1">
                119 - 142 <span className="text-xs font-normal text-primary/80">bpm</span>
              </p>
              <p className="font-label-sm text-label-sm text-on-surface-variant mt-1 text-xs">
                Máxima densidad mitocondrial (FatMax). 120-180 min/sem.
              </p>
            </div>
            <div className="font-label-sm text-label-sm text-primary font-semibold bg-surface-container-lowest px-2 py-1 rounded">
              Sustrato: Ácidos grasos libres
            </div>
          </div>

          <div className="p-space-sm bg-surface-container-low rounded-lg flex flex-col justify-between space-y-2 border border-surface-container/30">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm font-bold text-on-surface">Z3 · Tempo</span>
                <span className="font-code-data text-code-data text-on-surface-variant">72 - 82%</span>
              </div>
              <p className="font-headline-sm text-headline-sm text-on-surface font-bold mt-1">
                143 - 156 <span className="text-xs font-normal text-on-surface-variant">bpm</span>
              </p>
              <p className="font-label-sm text-label-sm text-on-surface-variant mt-1 text-xs">
                Aeróbico mixto. Acumulación progresiva de metabolitos.
              </p>
            </div>
            <div className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-lowest px-2 py-1 rounded">
              Sustrato: Glucosa + Grasas
            </div>
          </div>

          <div className="p-space-sm bg-surface-container-low rounded-lg flex flex-col justify-between space-y-2 border border-surface-container/30">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm font-bold text-on-surface">Z4 · Umbral</span>
                <span className="font-code-data text-code-data text-on-surface-variant">82 - 90%</span>
              </div>
              <p className="font-headline-sm text-headline-sm text-on-surface font-bold mt-1">
                157 - 171 <span className="text-xs font-normal text-on-surface-variant">bpm</span>
              </p>
              <p className="font-label-sm text-label-sm text-on-surface-variant mt-1 text-xs">
                Umbral anaeróbico. Tasa de eliminación igual a producción.
              </p>
            </div>
            <div className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-lowest px-2 py-1 rounded">
              Sustrato: Glucólisis rápida
            </div>
          </div>

          <div className="p-space-sm bg-surface-container-low rounded-lg flex flex-col justify-between space-y-2 border border-surface-container/30">
            <div>
              <div className="flex items-center justify-between">
                <span className="font-label-sm text-label-sm font-bold text-error">Z5 · VO2 Peak</span>
                <span className="font-code-data text-code-data text-error font-medium">90 - 100%</span>
              </div>
              <p className="font-headline-sm text-headline-sm text-on-surface font-bold mt-1">
                172 - 188 <span className="text-xs font-normal text-on-surface-variant">bpm</span>
              </p>
              <p className="font-label-sm text-label-sm text-on-surface-variant mt-1 text-xs">
                Protocolos SIT / HIIT. Máx reclutamiento motor (10-20 min/sem).
              </p>
            </div>
            <div className="font-label-sm text-label-sm text-on-surface-variant bg-surface-container-lowest px-2 py-1 rounded">
              Sustrato: Fosfágenos / Anaeróbico
            </div>
          </div>
        </div>
      </div>

      {/* Section 4: Preconfigured Protocols */}
      <div className="space-y-space-md">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-space-sm">
          <div>
            <h2 className="font-headline-md text-headline-md text-on-surface font-bold tracking-tight">
              Protocolos HIIT &amp; Prescripciones Aeróbicas
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Modalidades parametrizadas según equipamiento de gimnasio para maximizar adaptaciones mitocondriales sin fatiga neuromuscular.
            </p>
          </div>

          <div className="flex items-center gap-space-xs bg-surface-container-lowest p-1 rounded-lg shadow-xs border border-surface-container/40">
            <button
              onClick={() => setActiveProtocolFilter('all')}
              className={`px-3 py-1 rounded font-label-md text-label-md transition-colors ${
                activeProtocolFilter === 'all'
                  ? 'bg-surface-container text-on-surface font-semibold shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
              type="button"
            >
              Todos
            </button>
            <button
              onClick={() => setActiveProtocolFilter('z2')}
              className={`px-3 py-1 rounded font-label-md text-label-md transition-colors ${
                activeProtocolFilter === 'z2'
                  ? 'bg-surface-container text-on-surface font-semibold shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
              type="button"
            >
              Zona 2 Pura
            </button>
            <button
              onClick={() => setActiveProtocolFilter('hiit')}
              className={`px-3 py-1 rounded font-label-md text-label-md transition-colors ${
                activeProtocolFilter === 'hiit'
                  ? 'bg-surface-container text-on-surface font-semibold shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
              type="button"
            >
              HIIT Anaeróbico
            </button>
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
                onClick={() => showToast(`Protocolo cargado: "${p.title}"`)}
                className="mt-space-md w-full py-2 bg-surface-container-low hover:bg-primary hover:text-on-primary text-on-surface rounded-lg font-label-md text-label-md font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer border border-surface-container/40"
                type="button"
              >
                <span className="material-symbols-outlined text-sm">play_arrow</span>
                <span>Cargar Protocolo</span>
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Section 5: Real Telemetry Curve & Sensor Diagnostics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-space-md">
        <div className="lg:col-span-2 bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 space-y-space-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-xs pb-1 border-b border-surface-container/30">
            <div>
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">
                Registro Telemétrico Continuo
              </span>
              <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold tracking-tight">
                Última Sesión: Incline Treadmill Z2 (Hoy 07:15)
              </h3>
            </div>
            <div className="flex items-center gap-2 font-label-sm text-label-sm">
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-primary" /> Zona 2 Óptima
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-secondary-fixed" /> Cadencia
              </span>
            </div>
          </div>

          <div className="w-full bg-surface-container-low/60 rounded-xl p-space-md border border-surface-container/30">
            <div className="flex justify-between text-xs text-on-surface-variant font-code-data mb-2">
              <span>FC Máx Sesión: 139 bpm</span>
              <span>FC Media: 133 bpm</span>
              <span className="text-primary font-semibold">Tiempo en Zona 2: 94.2%</span>
            </div>
            <div className="w-full h-44 relative">
              <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 700 160">
                <defs>
                  <linearGradient id="cardioGradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#006948" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#006948" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                <line stroke="#cbd5e1" strokeDasharray="3 3" strokeWidth="1" x1="0" x2="700" y1="35" y2="35" />
                <text fill="#64748b" fontFamily="Inter" fontSize="10" textAnchor="end" x="695" y="32">
                  Límite Z2 (142 bpm)
                </text>
                <line stroke="#cbd5e1" strokeDasharray="3 3" strokeWidth="1" x1="0" x2="700" y1="110" y2="110" />
                <text fill="#64748b" fontFamily="Inter" fontSize="10" textAnchor="end" x="695" y="106">
                  Base Z2 (119 bpm)
                </text>

                <path
                  d="M 0 140 Q 40 125, 90 85 T 180 65 T 270 60 T 360 62 T 450 58 T 540 60 T 630 63 L 700 70 L 700 160 L 0 160 Z"
                  fill="url(#cardioGradient)"
                />
                <path
                  d="M 0 140 Q 40 125, 90 85 T 180 65 T 270 60 T 360 62 T 450 58 T 540 60 T 630 63 L 700 70"
                  fill="none"
                  stroke="#006948"
                  strokeLinecap="round"
                  strokeWidth="2.5"
                />
                <circle cx="180" cy="65" fill="#006948" r="4" className="animate-pulse" />
                <circle cx="450" cy="58" fill="#006948" r="4" />
                <circle cx="700" cy="70" fill="#006948" r="4" />
              </svg>
            </div>
            <div className="flex justify-between text-xs text-on-surface-variant font-code-data mt-2">
              <span>0 min</span>
              <span>10 min</span>
              <span>20 min</span>
              <span>30 min</span>
              <span>40 min</span>
              <span>45 min (Final)</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-space-sm pt-space-xs text-on-surface-variant font-label-sm text-label-sm">
            <div className="flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary text-base">check_circle</span>
              <span>Estabilidad cardíaca alcanzada a los 8 minutos de calentamiento progresivo.</span>
            </div>
            <span className="font-code-data text-on-surface font-semibold">Deriva Cardíaca: 2.1% (Excelente)</span>
          </div>
        </div>

        {/* Hardware Status */}
        <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col justify-between space-y-space-md">
          <div>
            <div className="flex items-center justify-between">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">
                Estado de Hardware
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-fixed/40 text-on-primary-fixed-variant font-label-sm text-label-sm font-semibold">
                Batería 92%
              </span>
            </div>
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold tracking-tight mt-1">
              Polar H10 Dual Band
            </h3>
            <p className="font-label-sm text-label-sm text-on-surface-variant">ECG 1-lead de grado clínico activo</p>

            <div className="mt-space-md space-y-space-sm">
              <div className="p-space-sm bg-surface-container-low rounded-lg space-y-1 border border-surface-container/30 text-xs">
                <div className="flex justify-between font-label-sm text-label-sm">
                  <span className="text-on-surface-variant">Frecuencia de Muestreo:</span>
                  <span className="font-semibold text-on-surface font-mono">1,000 Hz</span>
                </div>
                <div className="flex justify-between font-label-sm text-label-sm">
                  <span className="text-on-surface-variant">HRV / RMSSD Sesión:</span>
                  <span className="font-semibold text-primary">64 ms (Buena resiliencia)</span>
                </div>
                <div className="flex justify-between font-label-sm text-label-sm">
                  <span className="text-on-surface-variant">Conexión BLE / ANT+:</span>
                  <span className="font-semibold text-on-surface">Canal 2 Supabase Sync</span>
                </div>
              </div>

              <div className="p-space-sm bg-surface-container-high/40 rounded-lg space-y-1 text-xs">
                <span className="font-label-sm text-label-sm font-bold text-on-surface flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm text-primary">psychology</span>
                  Insight Mitocondrial
                </span>
                <p className="text-on-surface-variant">
                  Tus 135 minutos en Zona 2 esta semana han incrementado la relación de oxidación grasa/carbohidratos en un 4.8% en comparación con la línea base del mes anterior.
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={() => showToast('Transmisor Polar H10 calibrado exitosamente')}
            className="w-full py-2 bg-surface-container-low hover:bg-surface-container text-on-surface rounded-lg font-label-md text-label-md font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer border border-surface-container/40"
            type="button"
          >
            <span className="material-symbols-outlined text-base">refresh</span>
            <span>Recalibrar Transmisor</span>
          </button>
        </div>
      </div>

      {/* Section 6: Telemetry History Table */}
      <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 space-y-space-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm pb-1 border-b border-surface-container/30">
          <div>
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-bold tracking-tight">
              Historial Telemétrico Reciente
            </h3>
            <p className="font-body-md text-body-md text-on-surface-variant">
              Sesiones aeróbicas y anaeróbicas sincronizadas automáticamente desde dispositivos periféricos.
            </p>
          </div>
          <div className="flex items-center gap-space-xs">
            <span className="font-label-sm text-label-sm text-on-surface-variant">Filtrar por:</span>
            <select className="bg-surface-container-low text-on-surface font-label-sm text-label-sm py-1.5 px-3 rounded-lg border border-surface-container focus:ring-1 focus:ring-primary">
              <option>Últimos 14 días</option>
              <option>Mes actual</option>
              <option>Solo Zona 2</option>
              <option>Solo HIIT</option>
            </select>
          </div>
        </div>

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
                <th className="py-2.5 px-3 text-right rounded-r-lg">Telemetría</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container font-body-md text-body-md text-on-surface">
              {cardioSessions.map(session => (
                <tr key={session.id} className="hover:bg-surface-container-low/40 transition-colors">
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-primary text-lg">
                        {session.title.includes('Caminadora')
                          ? 'directions_walk'
                          : session.title.includes('Bike')
                          ? 'pedal_bike'
                          : 'rowing'}
                      </span>
                      <div>
                        <p className="font-semibold text-on-surface">{session.title}</p>
                        <p className="font-label-sm text-label-sm text-on-surface-variant">
                          {session.date} • {session.details}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-3 font-code-data font-medium">{session.durationMinutes} min</td>
                  <td className="py-3 px-3">
                    <span className="font-code-data font-semibold text-primary">{session.avgHr} bpm</span>
                  </td>
                  <td className="py-3 px-3 font-code-data text-on-surface-variant">{session.maxHr} bpm</td>
                  <td className="py-3 px-3">
                    {session.zone2Percentage > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className="font-code-data font-semibold">{session.zone2Minutes} min</span>
                        <span className="text-xs text-primary font-medium">({session.zone2Percentage}%)</span>
                      </div>
                    ) : (
                      <span className="font-code-data text-on-surface-variant">N/A (Foco Z5)</span>
                    )}
                  </td>
                  <td className="py-3 px-3 font-code-data font-semibold">{session.caloriesBurned} kcal</td>
                  <td className="py-3 px-3 text-right">
                    <span className="inline-flex items-center px-2 py-0.5 rounded bg-primary-fixed/30 text-on-primary-fixed-variant text-xs font-semibold">
                      {session.device}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
