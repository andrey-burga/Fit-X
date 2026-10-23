import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';

export const GuideSettingsView: React.FC = () => {
  const { navigate, showToast, biometrics } = useApp();

  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const rulesData = [
    {
      id: 'CALC-TDEE-01',
      category: 'formula',
      block: 'A',
      blockTitle: 'Bloque A: Reglas de Cálculo y Fórmulas Maestras',
      title: 'Cálculo de TDEE y Gasto Calórico Total',
      badge: 'FÓRMULA MATEMÁTICA',
      formulaTitle: 'ECUACIÓN MIFFLIN-ST JEOR MODIFICADA (HOMBRES) • PRECISIÓN: ±1.5%',
      formulaCode: `TMB = (10 × peso_kg) + (6.25 × altura_cm) - (5 × edad) + 5\nTDEE = TMB × Factor_PAL (${biometrics.palFactor}) = ${biometrics.tdee} kcal`,
      description: `Se aplica una restricción calórica lineal de ${biometrics.targetDeltaKcal} kcal/día (${Math.abs(Math.round((biometrics.targetDeltaKcal / biometrics.tdee) * 100))}% de reducción). De acuerdo con la literatura de Helms et al. (2014), un déficit moderado del 10% al 20% reduce preferentemente los adipocitos viscerales y subcutáneos mientras minimiza la atrofia del tejido esquelético miofibrilar bajo ingestas hiperproteicas.`,
      tags: 'tdee tmb gasto calorico deficit helms metabolismo basal factor actividad',
      footerLeft: 'Afecta en cascada: Menú Semanal, Registro Diario y Dashboard Nutricional',
      footerRight: 'Estado: Bloqueado en Backend',
    },
    {
      id: 'CALC-CHO-RESIDUAL',
      category: 'formula',
      block: 'A',
      blockTitle: 'Bloque A: Reglas de Cálculo y Fórmulas Maestras',
      title: 'Balance Dinámico de Carbohidratos (Buffer Residual)',
      badge: 'FÓRMULA MATEMÁTICA',
      formulaTitle: `RESOLUCIÓN DE MACRONUTRIENTES FIJOS VS. VARIABLES • PRESUPUESTO: ${biometrics.targetCalories} kcal`,
      formulaCode: `Carbohidratos_kcal = Presupuesto_kcal - (Proteínas_g × 4) - (Grasas_g × 9)\nCarbohidratos_g = Carbohidratos_kcal / 4.0 = ${biometrics.targetCarbsG}g`,
      description: `Al modificar los gramos por kilo de proteínas (meta actual ${biometrics.proteinPerKg} g/kg) o lípidos esenciales (${biometrics.fatPerKg} g/kg) en la pantalla de Configuración, la masa de hidratos de carbono absorbe íntegramente el delta neto para conservar fijos los ${biometrics.targetCalories} kcal sin romper la homeostasis isocalórica.`,
      tags: 'balance carbohidratos macros proteinas grasas asignacion automatica',
      footerLeft: 'Recálculo reactivo en tiempo real',
      footerRight: 'Prioridad de asignación: Lípido > Proteína > Glúcido',
    },
    {
      id: 'REC-LEU-MTOR',
      category: 'clinica',
      block: 'B',
      blockTitle: 'Bloque B: Recomendaciones Nutricionales (Guías Clínicas)',
      title: 'Distribución de Leucina y Estimulación del Complejo mTOR',
      badge: 'RECOMENDACIÓN CLÍNICA (FLEXIBLE)',
      highlightMetric: '≥3g',
      highlightMetricLabel: 'Umbral gatillo de leucina por ingesta principal',
      highlightSub: 'Desayuno (08:00) • Almuerzo (13:15) • Cena (20:30)',
      description: 'Se aconseja estructurar las comidas principales garantizando una masa crítica mínima de 3 gramos del aminoácido esencial L-Leucina para superar el umbral de saturación y desencadenar la señal de fosforilación ribosomal (vía MPS). Importante: Esta es una directriz de optimización fina para rendimiento muscular, no una regla restrictiva obligatoria; no penalizará el cumplimiento general de macronutrientes en el dashboard.',
      tags: 'leucina mtor sintesis proteica hipertrofia ventana anabolica comidas',
    },
    {
      id: 'REC-HYDR-04',
      category: 'clinica',
      block: 'B',
      blockTitle: 'Bloque B: Recomendaciones Nutricionales (Guías Clínicas)',
      title: 'Protocolo de Hidratación y Retención Hídrica Intracelular',
      badge: 'RECOMENDACIÓN CLÍNICA (FLEXIBLE)',
      gridMetrics: [
        { label: 'COEFICIENTE BASE', value: '40-45 ml/kg', desc: 'Volumen diario recomendado' },
        { label: 'VOLUMEN DIARIO ATLETA', value: '~3.2 Litros', desc: `Para peso actual de ${biometrics.weightKg} kg` },
        { label: 'INGESTA DE SODIO', value: '3,000 - 3,500 mg', desc: 'Estabilidad osmótica' },
      ],
      description: 'En días con doble estímulo (fuerza hipertrófica en la mañana y cardio/HIIT por la tarde), la pérdida electrolítica puede generar variaciones transitorias de ±1.2 kg en la báscula matutina debidas a vaciado o acumulación transitoria de glucógeno y retención intersticial ligada al sodio. El atleta no debe confundir estas fluctuaciones con ganancia o pérdida de tejido adiposo.',
      tags: 'hidratacion agua sodio retencion hidrica peso volumen sudoracion',
    },
    {
      id: 'ADJ-RATE-WEIGH',
      category: 'configurable',
      block: 'C',
      blockTitle: 'Bloque C: Parámetros Configurables y Umbrales de Ajuste',
      title: 'Criterio de Ajuste de Déficit / Superávit Calórico',
      badge: 'PARÁMETRO CONFIGURABLE',
      rangeVisual: true,
      description: 'El motor compara el promedio móvil ponderado de 7 días contra la semana previa. Si se cumplen las condiciones de meseta tras 21 días consecutivos de registro verificado (≥85% de adherencia calórica), el sistema genera automáticamente un banner de recomendación en el Dashboard Nutricional para recortar carbohidratos en la siguiente planificación semanal.',
      tags: 'deficit superavit ajuste peso balanza estancamiento catabolismo semanal',
    },
    {
      id: 'ADJ-SUB-TOLERANCE',
      category: 'configurable',
      block: 'C',
      blockTitle: 'Bloque C: Parámetros Configurables y Umbrales de Ajuste',
      title: 'Tolerancia en Equivalencias Isocalóricas',
      badge: 'PARÁMETRO CONFIGURABLE',
      toleranceValue: '±4.0%',
      description: 'En la pestaña Sustituciones, el conversor de gramos utiliza una ventana de holgura de ±4.0% Kcal. Si la porción equivalente seleccionada por el usuario excede este desvío energético respecto a la receta original, el algoritmo propone automáticamente una compensación de ajuste fino (por ejemplo: +5 ml de Aceite de Oliva Virgen Extra o +15 g de arroz blanco jazmín cocido) para neutralizar la diferencia.',
      tags: 'tolerancia isocalorica sustituciones equivalencias aove carbohidratos margen error',
    },
    {
      id: 'INF-WEIGH-RAW',
      category: 'informativa',
      block: 'D',
      blockTitle: 'Bloque D: Instrucciones Informativas y Buenas Prácticas',
      title: 'Metodología de Pesaje de Alimentos (Crudo vs. Cocido)',
      badge: 'INSTRUCCIÓN DE REGISTRO',
      iconInfo: 'restaurant',
      description: 'Regla de oro: Todos los granos secos (arroz, pasta, avena, lentejas) y cortes cárnicos (pechuga, res magra, salmón) en la base de datos de Vigor se contabilizan estrictamente en peso neto crudo antes de cualquier cocción.\n* Excepción única: Si el nombre del insumo o el chip explícitamente porta la etiqueta "(cocido)" o "(asado)", en cuyo caso ya contempla el factor de merma hídrica (ej. Factor 2.25 en arroz cocido).',
      tags: 'pesaje balanza crudo cocido gramos arroz pasta carne densidad agua',
    },
    {
      id: 'INF-DB-NULL-SAFETY',
      category: 'informativa',
      block: 'D',
      blockTitle: 'Bloque D: Instrucciones Informativas y Buenas Prácticas',
      title: 'Tratamiento de Días Sin Registrar y Ayuno (Integridad SQL)',
      badge: 'INTEGRIDAD DE DATOS (SUPABASE)',
      sqlCode: "UPDATE logs_diarios SET calorias = NULL WHERE tipo_registro = 'unlogged';",
      description: "Dejar tomas vacías en días futuros, fines de semana o jornadas de descanso planificado conserva el estado NULL en la tabla de Supabase. Nunca introduzca ceros arbitrarios ('0 kcal') en días no registrados para 'completar casillas': introducir un cero computa como un día real de inanición absoluta y descalibra severamente el promedio móvil de gasto metabólico y TDEE.",
      tags: 'sql supabase null ayuno integridad datos base de datos ceros vacio',
    },
  ];

  const filteredRules = useMemo(() => {
    return rulesData.filter(item => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        q === '' ||
        item.title.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.tags.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q);

      const matchesCategory =
        activeCategory === 'all' || item.category === activeCategory;

      return matchesSearch && matchesCategory;
    });
  }, [searchQuery, activeCategory, biometrics]);

  // Group by block
  const groupedRules = useMemo(() => {
    const groups: Record<string, { title: string; items: typeof rulesData }> = {};
    filteredRules.forEach(r => {
      if (!groups[r.block]) {
        groups[r.block] = { title: r.blockTitle, items: [] };
      }
      groups[r.block].items.push(r);
    });
    return groups;
  }, [filteredRules]);

  return (
    <div className="p-4 sm:p-gutter-desktop max-w-[1440px] mx-auto w-full flex flex-col gap-space-lg animate-in fade-in duration-150">
      {/* Header */}
      <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-space-md">
        <div className="flex flex-col gap-space-xs max-w-3xl">
          <div className="flex items-center gap-space-xs flex-wrap">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface-container-high text-on-surface-variant font-label-sm text-label-sm uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              DOCUMENTACIÓN Y REGLAS DE NEGOCIO • VERSIÓN 4.2
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary-fixed text-on-primary-fixed font-code-data text-code-data">
              <span className="material-symbols-outlined text-[14px]">lock</span>
              Sincronización Estricta
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface font-semibold tracking-tight">
            Guía y Ajustes del Protocolo Nutricional
          </h1>
          <p className="font-body-lg text-body-lg text-on-surface-variant">
            Compendio sistemático de directrices clínicas, fórmulas matemáticas, umbrales de ajuste metabólico y criterios de adherencia derivados de la hoja maestra de cálculo.
          </p>
        </div>

        <div className="flex items-center gap-space-xs shrink-0 self-start lg:self-center">
          <button
            onClick={() => showToast('Generando compilado PDF de directrices y fórmulas (v4.2)...')}
            className="flex items-center gap-space-xs px-3.5 py-2 bg-surface-container-lowest hover:bg-surface-container text-on-surface font-label-md text-label-md rounded-lg shadow-xs transition-colors cursor-pointer border border-surface-container"
            type="button"
          >
            <span className="material-symbols-outlined text-lg text-on-surface-variant">download</span>
            <span>Descargar Manual Completo</span>
          </button>
          <button
            onClick={() => {
              showToast('Parámetros de la guía restablecidos a los valores predeterminados Helms-Norton');
            }}
            className="flex items-center gap-space-xs px-3.5 py-2 bg-surface-container-low hover:bg-surface-container-highest text-on-surface font-label-md text-label-md rounded-lg transition-colors cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined text-lg text-on-surface-variant">restart_alt</span>
            <span className="hidden sm:inline">Restaurar Parámetros</span>
          </button>
        </div>
      </header>

      {/* Filter and Search Bar */}
      <section className="bg-surface-container-lowest rounded-xl p-space-md shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
        <div className="relative w-full">
          <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant text-xl">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar regla, parámetro, fórmula o protocolo (ej. déficit, leucina, agua, pesaje)..."
            className="w-full pl-11 pr-10 py-2.5 bg-surface-container-low rounded-lg text-on-surface font-body-md text-body-md placeholder:text-on-surface-variant/70 focus:outline-none focus:bg-surface-container-lowest focus:ring-2 focus:ring-primary/20 border border-surface-container/40 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          )}
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-space-xs overflow-x-auto pb-1 text-nowrap scrollbar-none">
          {[
            { id: 'all', label: 'Todas las Directrices', count: 8 },
            { id: 'formula', label: 'Reglas de Cálculo', count: 2, color: 'bg-amber-500' },
            { id: 'clinica', label: 'Recomendaciones Clínicas', count: 2, color: 'bg-primary' },
            { id: 'configurable', label: 'Parámetros Configurables', count: 2, color: 'bg-tertiary' },
            { id: 'informativa', label: 'Instrucciones Informativas', count: 2, color: 'bg-secondary' },
          ].map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveCategory(c.id)}
              className={`px-3 py-1.5 rounded-lg font-label-md text-label-md transition-all flex items-center gap-1.5 ${
                activeCategory === c.id
                  ? 'bg-primary text-on-primary shadow-xs font-semibold'
                  : 'bg-surface-container-low hover:bg-surface-container text-on-surface-variant'
              }`}
            >
              {c.color && <span className={`w-2 h-2 rounded-full ${c.color}`} />}
              <span>{c.label}</span>
              <span
                className={`px-1.5 py-0.2 rounded-full text-label-sm font-code-data ${
                  activeCategory === c.id ? 'bg-on-primary/20 text-on-primary' : 'bg-surface-container text-on-surface-variant'
                }`}
              >
                {c.count}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* 2-Column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg items-start">
        {/* Left Column (8 Cols): Content Blocks */}
        <div className="lg:col-span-8 flex flex-col gap-space-lg">
          {Object.keys(groupedRules).length === 0 ? (
            <div className="bg-surface-container-lowest rounded-xl p-space-xl text-center text-on-surface-variant border border-surface-container/50">
              No se encontraron directrices coincidentes con "{searchQuery}".
            </div>
          ) : (
            Object.entries(groupedRules).map(([blockKey, block]) => (
              <div key={blockKey} className="flex flex-col gap-space-md">
                <div className="flex items-center justify-between pb-space-xs">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-xl">
                      {blockKey === 'A' ? 'functions' : blockKey === 'B' ? 'verified' : blockKey === 'C' ? 'tune' : 'info'}
                    </span>
                    <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold tracking-tight">
                      {block.title}
                    </h2>
                  </div>
                  <span className="font-code-data text-code-data text-on-surface-variant bg-surface-container px-2 py-0.5 rounded font-medium">
                    {blockKey === 'A' ? 'Core Logic • Solo lectura' : blockKey === 'B' ? 'No punitivas • Optimización' : blockKey === 'C' ? 'Interactivos • Modificables' : 'Procedimentales • Uso Correcto'}
                  </span>
                </div>

                {block.items.map(rule => (
                  <article
                    key={rule.id}
                    className="bg-surface-container-lowest rounded-xl shadow-xs border border-surface-container/50 p-space-md flex flex-col gap-space-md hover:shadow-md transition-shadow"
                  >
                    <div className="flex items-start justify-between gap-space-sm">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span
                            className={`px-2 py-0.5 rounded text-label-sm font-code-data font-semibold tracking-wide ${
                              rule.category === 'formula'
                                ? 'bg-amber-100 text-amber-900'
                                : rule.category === 'clinica'
                                ? 'bg-emerald-50 text-emerald-800'
                                : rule.category === 'configurable'
                                ? 'bg-indigo-50 text-indigo-900'
                                : 'bg-slate-100 text-slate-800'
                            }`}
                          >
                            {rule.badge}
                          </span>
                          <span className="font-code-data text-code-data text-on-surface-variant">
                            ID: {rule.id}
                          </span>
                        </div>
                        <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                          {rule.title}
                        </h3>
                      </div>
                      <span className="material-symbols-outlined text-on-surface-variant">
                        {rule.category === 'formula' ? 'lock' : rule.category === 'clinica' ? 'fitness_center' : rule.category === 'configurable' ? 'tune' : 'scale'}
                      </span>
                    </div>

                    {/* Formula Code */}
                    {rule.formulaCode && (
                      <div className="bg-surface-container-low rounded-lg p-space-sm flex flex-col gap-1.5 font-code-data text-code-data text-on-surface border border-surface-container/40">
                        <div className="flex items-center justify-between text-on-surface-variant font-label-sm">
                          <span>{rule.formulaTitle}</span>
                        </div>
                        <pre className="p-2 rounded bg-surface-container-lowest overflow-x-auto text-on-surface tracking-tight font-mono text-xs">
                          {rule.formulaCode}
                        </pre>
                      </div>
                    )}

                    {/* Highlight Metric */}
                    {rule.highlightMetric && (
                      <div className="p-3 bg-surface-container-low rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-space-sm border border-surface-container/40">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-surface-container-lowest flex items-center justify-center font-metric-md text-metric-md font-bold text-primary shadow-xs">
                            {rule.highlightMetric}
                          </div>
                          <div className="flex flex-col">
                            <span className="font-label-md text-label-md font-semibold text-on-surface">
                              {rule.highlightMetricLabel}
                            </span>
                            <span className="font-label-sm text-label-sm text-on-surface-variant">
                              {rule.highlightSub}
                            </span>
                          </div>
                        </div>
                        <span className="px-2.5 py-1 rounded-full text-label-sm font-label-sm bg-surface-container-lowest text-on-surface font-semibold shadow-xs">
                          3 Pulsos Diarios Recomendados
                        </span>
                      </div>
                    )}

                    {/* Grid Metrics (Hydration) */}
                    {rule.gridMetrics && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-space-sm">
                        {rule.gridMetrics.map((gm, i) => (
                          <div key={i} className="p-3 bg-surface-container-low rounded-lg flex flex-col border border-surface-container/40">
                            <span className="text-on-surface-variant font-label-sm text-label-sm">{gm.label}</span>
                            <span className="font-metric-md text-metric-md text-primary font-bold">{gm.value}</span>
                            <span className="text-on-surface-variant font-label-sm">{gm.desc}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Range Visualizer (Deficit Adjustment) */}
                    {rule.rangeVisual && (
                      <div className="bg-surface-container-low rounded-lg p-space-sm flex flex-col gap-space-sm border border-surface-container/40">
                        <div className="flex items-center justify-between text-label-sm font-label-sm">
                          <span className="text-on-surface-variant font-medium">VENTANA ÓPTIMA DE PÉRDIDA SEMANAL</span>
                          <span className="font-code-data font-semibold text-primary">Estado: ACTIVO • Monitoreando</span>
                        </div>
                        <div className="relative w-full h-8 bg-surface-container rounded-lg overflow-hidden flex text-label-sm font-code-data">
                          <div className="w-1/3 bg-amber-100 flex items-center justify-center text-amber-900 font-medium">
                            &lt; -0.30 kg/sem (Meseta)
                          </div>
                          <div className="w-1/3 bg-emerald-100 flex items-center justify-center text-emerald-900 font-bold border-x border-emerald-300/40">
                            -0.30 a -0.80 kg/sem (Óptimo)
                          </div>
                          <div className="w-1/3 bg-red-100 flex items-center justify-center text-red-900 font-medium">
                            &gt; -0.80 kg/sem (Riesgo Catabólico)
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Tolerance Value */}
                    {rule.toleranceValue && (
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-low">
                        <span className="text-on-surface-variant font-label-md text-label-md">Margen de Tolerancia Calórica:</span>
                        <span className="font-code-data font-bold text-primary text-sm px-2 py-0.5 rounded bg-surface-container-lowest">
                          {rule.toleranceValue}
                        </span>
                      </div>
                    )}

                    {/* SQL code */}
                    {rule.sqlCode && (
                      <div className="bg-surface-container-low rounded-lg p-space-sm font-code-data text-code-data text-on-surface flex flex-col gap-1 border border-surface-container/40">
                        <div className="flex items-center justify-between text-on-surface-variant font-label-sm">
                          <span>ESTÁNDAR RELACIONAL POSTGRESQL / SUPABASE</span>
                          <span className="text-primary font-semibold">NULL ≠ 0 kcal</span>
                        </div>
                        <div className="p-2 rounded bg-surface-container-lowest text-on-surface font-mono text-xs">
                          <code>{rule.sqlCode}</code>
                        </div>
                      </div>
                    )}

                    <p className="text-on-surface-variant font-body-md text-body-md whitespace-pre-line">
                      {rule.description}
                    </p>

                    {/* Card Footer */}
                    {rule.footerLeft && (
                      <div className="pt-space-xs flex items-center justify-between flex-wrap gap-2 text-label-sm font-label-sm text-on-surface-variant bg-surface-container-low/60 p-2.5 rounded-lg border border-surface-container/30">
                        <span className="flex items-center gap-1.5 text-on-surface font-medium">
                          <span className="material-symbols-outlined text-[16px] text-tertiary">hub</span>
                          <span>{rule.footerLeft}</span>
                        </span>
                        <span className="text-primary font-code-data font-semibold">{rule.footerRight}</span>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            ))
          )}
        </div>

        {/* Right Column (4 Cols): Active Telemetry & Version History */}
        <aside className="lg:col-span-4 flex flex-col gap-space-lg sticky top-20">
          <div className="bg-surface-container-lowest rounded-xl shadow-xs border border-surface-container/50 p-space-md flex flex-col gap-space-md">
            <div className="flex items-center justify-between pb-space-xs border-b border-surface-container/40">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-lg">tune</span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">Configuración Activa</h3>
              </div>
              <span className="inline-flex items-center gap-1 font-label-sm text-label-sm text-primary font-semibold bg-primary-fixed px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                Sincronizado v4.2
              </span>
            </div>

            <div className="grid grid-cols-2 gap-space-sm">
              <div className="bg-surface-container-low p-space-sm rounded-lg flex flex-col border border-surface-container/40">
                <span className="font-label-sm text-label-sm text-on-surface-variant">TDEE ESTIMADO</span>
                <span className="font-metric-md text-metric-md text-on-surface font-bold tracking-tight">
                  {biometrics.tdee} <span className="font-label-sm text-label-sm font-normal text-on-surface-variant">kcal</span>
                </span>
                <span className="font-label-sm text-label-sm text-secondary">PAL {biometrics.palFactor}</span>
              </div>
              <div className="bg-surface-container-low p-space-sm rounded-lg flex flex-col border border-surface-container/40">
                <span className="font-label-sm text-label-sm text-on-surface-variant">PRESUPUESTO NETO</span>
                <span className="font-metric-md text-metric-md text-primary font-bold tracking-tight">
                  {biometrics.targetCalories} <span className="font-label-sm text-label-sm font-normal text-on-surface-variant">kcal</span>
                </span>
                <span className="font-label-sm text-label-sm text-primary font-medium">{biometrics.targetDeltaKcal} kcal</span>
              </div>
              <div className="bg-surface-container-low p-space-sm rounded-lg flex flex-col border border-surface-container/40">
                <span className="font-label-sm text-label-sm text-on-surface-variant">PROTEÍNAS</span>
                <span className="font-metric-md text-metric-md text-on-surface font-bold tracking-tight">
                  {biometrics.targetProteinG} <span className="font-label-sm text-label-sm font-normal text-on-surface-variant">g</span>
                </span>
                <span className="font-label-sm text-label-sm text-secondary">{biometrics.proteinPerKg} g/kg</span>
              </div>
              <div className="bg-surface-container-low p-space-sm rounded-lg flex flex-col border border-surface-container/40">
                <span className="font-label-sm text-label-sm text-on-surface-variant">GRASAS</span>
                <span className="font-metric-md text-metric-md text-on-surface font-bold tracking-tight">
                  {biometrics.targetFatG} <span className="font-label-sm text-label-sm font-normal text-on-surface-variant">g</span>
                </span>
                <span className="font-label-sm text-label-sm text-secondary">{biometrics.fatPerKg} g/kg</span>
              </div>
            </div>

            <div className="flex flex-col gap-space-xs pt-space-xs">
              <button
                onClick={() => navigate('configuracion-nutricional')}
                className="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md transition-all cursor-pointer border border-surface-container/40"
              >
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-base">settings_suggest</span>
                  <span>Editar Parámetros en Configuración</span>
                </span>
                <span className="material-symbols-outlined text-base text-on-surface-variant">arrow_forward</span>
              </button>
              <button
                onClick={() => navigate('dashboard-nutricional')}
                className="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md transition-all cursor-pointer border border-surface-container/40"
              >
                <span className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-tertiary text-base">analytics</span>
                  <span>Visualizar en Dashboard</span>
                </span>
                <span className="material-symbols-outlined text-base text-on-surface-variant">arrow_forward</span>
              </button>
            </div>
          </div>

          {/* Version History Card */}
          <div className="bg-surface-container-lowest rounded-xl shadow-xs border border-surface-container/50 p-space-md flex flex-col gap-space-md">
            <div className="flex items-center justify-between pb-space-xs border-b border-surface-container/40">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-lg">history</span>
                <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">Versiones del Protocolo</h3>
              </div>
              <span className="font-code-data text-code-data text-on-surface-variant">Branch: Master</span>
            </div>

            <div className="flex flex-col gap-space-md relative pl-4 before:content-[''] before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-surface-container">
              <div className="relative flex flex-col gap-1">
                <span className="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-primary-fixed" />
                <div className="flex items-center justify-between">
                  <span className="font-code-data text-code-data font-bold text-primary">v4.2.1 (Actual)</span>
                  <span className="font-label-sm text-label-sm text-on-surface-variant">Hace 3 días</span>
                </div>
                <p className="font-body-md text-body-md text-on-surface-variant text-xs">
                  Calibración de umbrales DIAAS en sustituciones proteicas cruzadas.
                </p>
              </div>

              <div className="relative flex flex-col gap-1">
                <span className="absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full bg-surface-container-highest" />
                <div className="flex items-center justify-between">
                  <span className="font-code-data text-code-data font-semibold text-on-surface">v4.0.0</span>
                  <span className="font-label-sm text-label-sm text-on-surface-variant">12 Oct 2024</span>
                </div>
                <p className="font-body-md text-body-md text-on-surface-variant text-xs">
                  Definición del macro split e integración de amortiguador dinámico de CHO.
                </p>
              </div>
            </div>
          </div>

          {/* Clinical Certification Banner */}
          <div className="bg-primary/5 rounded-xl p-space-md flex flex-col gap-2 border border-primary/10">
            <div className="flex items-center gap-2 text-primary font-semibold font-label-md text-label-md">
              <span className="material-symbols-outlined text-lg">verified_user</span>
              <span>Metodología Basada en Evidencia</span>
            </div>
            <p className="text-on-surface-variant font-body-md text-body-md text-xs">
              Todos los algoritmos de este SaaS operan de conformidad con las guías de la ISSN (International Society of Sports Nutrition) y el modelo de periodización energética de Eric Helms (PhD, CSCS).
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
};
