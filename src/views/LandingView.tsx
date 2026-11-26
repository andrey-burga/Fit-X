/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Página de Inicio Pública (Fase 5.5.1)
 *
 * Descripción general estrictamente pública en español:
 * - No ejecuta consultas protegidas ni suscripciones a Firestore al montar.
 * - No redirige automáticamente al inicio de sesión ni a rutas privadas.
 * - La autenticación inicia únicamente por acción explícita del usuario.
 * - Comunica solo capacidades verificadas en el código; omite testimonios,
 *   métricas inventadas, certificaciones no verificadas o integraciones inexistentes.
 */

import React, { useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowRight,
  Calculator,
  CalendarRange,
  Dumbbell,
  Menu,
  ShieldCheck,
  ShoppingBasket,
  TrendingUp,
  X,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { PublicFooter } from '../components/layout/PublicFooter';
import studioPreviewImg from '../assets/images/vigorcore_performance_studio_1795539366902.jpg';

type PreviewTab = 'nutricion' | 'mesociclo' | 'analitica';
type NutritionScenario = 'deficit' | 'mantenimiento' | 'superavit';
type MesocyclePreviewWeek = 1 | 4;

const PREVIEW_SCENARIOS: Record<
  NutritionScenario,
  {
    shortLabel: string;
    label: string;
    targetKcal: number;
    proteinG: number;
    fatG: number;
    carbsG: number;
  }
> = {
  deficit: {
    shortLabel: 'Déficit',
    label: 'Déficit moderado (-400 kcal)',
    targetKcal: 2251,
    proteinG: 149,
    fatG: 60,
    carbsG: 279,
  },
  mantenimiento: {
    shortLabel: 'Mant.',
    label: 'Mantenimiento (0 kcal)',
    targetKcal: 2651,
    proteinG: 149,
    fatG: 60,
    carbsG: 379,
  },
  superavit: {
    shortLabel: 'Superávit',
    label: 'Superávit controlado (+250 kcal)',
    targetKcal: 2901,
    proteinG: 149,
    fatG: 60,
    carbsG: 441,
  },
};

const MESOCYCLE_WEEKS: Record<
  MesocyclePreviewWeek,
  {
    title: string;
    phaseNote: string;
    sets: Array<{ name: string; scheme: string; rir: string; load: string; est1Rm: string }>;
  }
> = {
  1: {
    title: 'Semana 1 · Acumulación Torso A',
    phaseNote: 'Volumen base efectivo (objetivo RIR 2)',
    sets: [
      { name: 'Remo con barra Pendlay', scheme: '4 x 8', rir: 'RIR 2', load: '75,0 kg', est1Rm: '95,0 kg' },
      { name: 'Press inclinado con mancuernas', scheme: '3 x 10', rir: 'RIR 2', load: '30,0 kg', est1Rm: '40,0 kg' },
      { name: 'Dominadas lastradas', scheme: '3 x 8', rir: 'RIR 1', load: '+12,5 kg', est1Rm: '—' },
    ],
  },
  4: {
    title: 'Semana 4 · Descarga programada',
    phaseNote: 'Reducción de series efectivas y fatiga (objetivo RIR 4)',
    sets: [
      { name: 'Remo con barra Pendlay', scheme: '2 x 6', rir: 'RIR 4', load: '65,0 kg', est1Rm: '78,0 kg' },
      { name: 'Press inclinado con mancuernas', scheme: '2 x 8', rir: 'RIR 4', load: '25,0 kg', est1Rm: '31,7 kg' },
      { name: 'Dominadas lastradas', scheme: '2 x 6', rir: 'RIR 4', load: 'Peso corporal', est1Rm: '—' },
    ],
  },
};

const WORKLOAD_SAMPLE_WEEKS = [
  { week: 'Sem. -3', tonnageKg: 14200, formatted: '14.200' },
  { week: 'Sem. -2', tonnageKg: 15100, formatted: '15.100' },
  { week: 'Sem. -1', tonnageKg: 15850, formatted: '15.850' },
  { week: 'Actual', tonnageKg: 16400, formatted: '16.400' },
];

const MODULE_ITEMS = [
  {
    number: '01',
    span: 'md:col-span-7',
    icon: Calculator,
    scope: 'Mifflin-St Jeor · Factor PAL · Snapshots reversibles',
    title: 'Metabolismo y periodización nutricional',
    description:
      'Calcula tasa metabólica basal y gasto energético diario según peso, estatura, edad y nivel de actividad. Define proteína y grasa en g/kg asignando las calorías restantes a carbohidratos, con respaldo reversible entre fases.',
  },
  {
    number: '02',
    span: 'md:col-span-5',
    icon: ShoppingBasket,
    scope: 'Menú de 7 días · Diario · Lista idempotente',
    title: 'Plan semanal, sustituciones y compras',
    description:
      'Organiza desayuno, almuerzo, merienda y cena en la semana, registra comidas diarias, consulta equivalencias nutricionales en catálogo y genera la lista de compras agrupada por categorías respetando ajustes manuales.',
  },
  {
    number: '03',
    span: 'md:col-span-5',
    icon: CalendarRange,
    scope: 'Asistente en 3 pasos · Bloques · Descargas',
    title: 'Planificador de mesociclos y rutinas',
    description:
      'Sugiere divisiones semanales según frecuencia, experiencia y objetivo, o permite armar rutinas personalizadas con rangos de repeticiones, RIR objetivo y semanas de descarga.',
  },
  {
    number: '04',
    span: 'md:col-span-7',
    icon: Dumbbell,
    scope: 'Series y RIR · 1RM Epley · Cola aislada por cuenta',
    title: 'Registro en vivo y respaldo offline',
    description:
      'Registra peso, repeticiones y RIR serie por serie durante la sesión con temporizador de descanso y cálculo de 1RM estimado por Epley. Las series pendientes sin conexión se aíslan por identificador de cuenta.',
  },
  {
    number: '05',
    span: 'md:col-span-6',
    icon: TrendingUp,
    scope: 'Tonelaje efectivo · Índice ACWR · CSV y PDF',
    title: 'Progreso, carga semanal y exportación',
    description:
      'Supervisa tonelaje semanal efectivo, relación de carga aguda:crónica (ACWR), tendencia de 1RM en ejercicios compuestos y alertas de estancamiento o descarga, con exportación en CSV y PDF.',
  },
  {
    number: '06',
    span: 'md:col-span-6',
    icon: ShieldCheck,
    scope: 'Cardio manual Zona 2 / HIIT · Roles e invitaciones',
    title: 'Cardio manual y gobierno por invitación',
    description:
      'Incluye protocolos de referencia Zona 2 y HIIT con registro manual de sesiones (sin sincronización automática por Bluetooth o relojes inteligentes), además de ingreso por invitación y control por roles.',
  },
] as const;

const WORKFLOW_STEPS = [
  {
    step: '01',
    title: 'Configura tu línea base metabólica y de fuerza',
    description:
      'Ingresa peso, estatura, edad, factor de actividad (PAL), unidades preferidas y días disponibles para obtener metas diarias de macronutrientes y una estructura inicial de entrenamiento.',
  },
  {
    step: '02',
    title: 'Organiza tu semana alimentaria y bloque de fuerza',
    description:
      'Asigna comidas en el calendario semanal para consolidar tu lista de compras por secciones y ajusta un mesociclo con cargas, RIR objetivo y descargas programadas.',
  },
  {
    step: '03',
    title: 'Registra la ejecución diaria y monitorea la carga',
    description:
      'Documenta comidas y series efectivas en vivo mientras evalúas tu tonelaje semanal, la estimación 1RM por Epley y el equilibrio de carga ACWR.',
  },
] as const;

export const LandingView: React.FC = () => {
  const { navigate, isAuthenticated } = useApp();
  const [previewTab, setPreviewTab] = useState<PreviewTab>('nutricion');
  const [nutritionScenario, setNutritionScenario] = useState<NutritionScenario>('deficit');
  const [mesocycleWeek, setMesocycleWeek] = useState<MesocyclePreviewWeek>(1);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [studioImageFailed, setStudioImageFailed] = useState(false);

  const activeNutrition = PREVIEW_SCENARIOS[nutritionScenario];
  const activeMesocycle = MESOCYCLE_WEEKS[mesocycleWeek];

  const macroDistributionPct = useMemo(() => {
    const proteinKcal = activeNutrition.proteinG * 4;
    const fatKcal = activeNutrition.fatG * 9;
    const carbsKcal = activeNutrition.carbsG * 4;
    const total = proteinKcal + fatKcal + carbsKcal || 1;
    return {
      protein: Math.round((proteinKcal / total) * 100),
      fat: Math.round((fatKcal / total) * 100),
      carbs: Math.max(0, 100 - Math.round((proteinKcal / total) * 100) - Math.round((fatKcal / total) * 100)),
    };
  }, [activeNutrition]);

  const maxSampleTonnage = useMemo(
    () => Math.max(...WORKLOAD_SAMPLE_WEEKS.map(w => w.tonnageKg)),
    []
  );

  const scrollToSection = (sectionId: string) => {
    setMobileMenuOpen(false);
    if (typeof document === 'undefined') return;
    const target = document.getElementById(sectionId);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleSignInAction = () => {
    setMobileMenuOpen(false);
    if (isAuthenticated) {
      navigate('dashboard-nutricional');
      return;
    }
    navigate('login');
  };

  return (
    <div className="min-h-screen bg-background text-on-background font-landing-body antialiased selection:bg-primary-fixed selection:text-on-primary-fixed">
      {/* Barra superior de 3 zonas */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-outline-variant/50">
        <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-6">
          {/* Zona 1: Marca VigorCore */}
          <a
            href="#/"
            onClick={e => {
              e.preventDefault();
              scrollToSection('resumen');
            }}
            className="inline-flex items-center gap-2.5 font-landing-display text-lg font-bold tracking-tight text-on-background whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
          >
            <span
              className="w-7 h-7 rounded-lg bg-primary text-on-primary inline-flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <Activity className="w-4 h-4" />
            </span>
            <span>
              Vigor<span className="text-primary">Core</span>
            </span>
          </a>

          {/* Zona 2: Enlaces de sección en español */}
          <nav
            aria-label="Secciones principales"
            className="hidden md:flex items-center gap-7 text-sm font-medium text-on-surface-variant"
          >
            <button
              type="button"
              onClick={() => scrollToSection('modulos')}
              className="hover:text-on-background hover:underline underline-offset-4 transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            >
              Módulos
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('confianza')}
              className="hover:text-on-background hover:underline underline-offset-4 transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            >
              Modelo de acceso
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('como-funciona')}
              className="hover:text-on-background hover:underline underline-offset-4 transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            >
              Cómo funciona
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('acceso')}
              className="hover:text-on-background hover:underline underline-offset-4 transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
            >
              Ingreso
            </button>
          </nav>

          {/* Zona 3: Acción de acceso + menú móvil */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleSignInAction}
              className="px-4 py-2 rounded-lg border border-outline-variant bg-surface-container-lowest hover:bg-surface-container-low text-on-background text-sm font-semibold transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer min-h-[40px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {isAuthenticated ? 'Abrir espacio privado' : 'Iniciar sesión'}
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen(prev => !prev)}
              aria-expanded={mobileMenuOpen}
              aria-label={mobileMenuOpen ? 'Cerrar menú de navegación' : 'Abrir menú de navegación'}
              className="md:hidden inline-flex items-center justify-center w-10 h-10 rounded-lg border border-outline-variant bg-surface-container-lowest text-on-background hover:bg-surface-container-low transition-colors duration-150 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {mobileMenuOpen ? (
                <X className="w-5 h-5" aria-hidden="true" />
              ) : (
                <Menu className="w-5 h-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Menú móvil desplegable */}
        {mobileMenuOpen && (
          <nav
            aria-label="Secciones en móvil"
            className="md:hidden border-t border-outline-variant/50 bg-surface-container-lowest px-4 py-3 flex flex-col gap-1"
          >
            <button
              type="button"
              onClick={() => scrollToSection('modulos')}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium text-on-background hover:bg-surface-container-low min-h-[44px]"
            >
              Módulos
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('confianza')}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium text-on-background hover:bg-surface-container-low min-h-[44px]"
            >
              Modelo de acceso
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('como-funciona')}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium text-on-background hover:bg-surface-container-low min-h-[44px]"
            >
              Cómo funciona
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('acceso')}
              className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium text-on-background hover:bg-surface-container-low min-h-[44px]"
            >
              Ingreso
            </button>
          </nav>
        )}
      </header>

      <main>
        {/* A. SECCIÓN PRINCIPAL (HERO) */}
        <section
          id="resumen"
          className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-14 sm:pt-12 sm:pb-18"
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-stretch">
            {/* Propuesta de valor y llamados a la acción */}
            <div className="lg:col-span-5 flex flex-col justify-center space-y-5">
              <p className="text-xs font-semibold tracking-wide text-primary">
                Plataforma de nutrición estructurada y entrenamiento de fuerza
              </p>

              <h1
                className="font-landing-display font-bold tracking-tight text-on-background leading-[1.08]"
                style={{ fontSize: 'clamp(2.05rem, 3.4vw, 3.1rem)', textWrap: 'balance' }}
              >
                Entrenamiento y nutrición, conectados con tu progreso.
              </h1>

              <p className="text-base leading-relaxed text-on-surface-variant max-w-xl">
                Planifica tu alimentación con cálculo metabólico Mifflin-St Jeor, convierte tu menú
                semanal en lista de compras, estructura mesociclos de fuerza y registra cada serie
                junto a tu carga ACWR.
              </p>

              <div className="flex flex-col sm:flex-row sm:items-center gap-3.5 pt-1">
                <button
                  type="button"
                  onClick={() => scrollToSection('modulos')}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-lg bg-primary hover:bg-primary-container text-on-primary text-sm font-semibold transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer min-h-[44px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span>Descubrir VigorCore</span>
                  <ArrowDown className="w-4 h-4" aria-hidden="true" />
                </button>

                <button
                  type="button"
                  onClick={handleSignInAction}
                  className="inline-flex items-center justify-center sm:justify-start gap-1.5 px-2 py-2.5 text-sm font-medium text-on-surface-variant hover:text-primary underline underline-offset-4 transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer min-h-[44px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span>
                    {isAuthenticated ? 'Ir a mi espacio privado' : 'Ya tengo acceso · Iniciar sesión'}
                  </span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="pt-3 border-t border-outline-variant/50 grid grid-cols-3 gap-2 text-[11px] sm:text-xs text-on-surface-variant">
                <div className="font-medium text-on-background">TDEE Mifflin-St Jeor</div>
                <div className="font-medium text-on-background border-l border-outline-variant/50 pl-2.5">
                  Mesociclos y 1RM
                </div>
                <div className="font-medium text-on-background border-l border-outline-variant/50 pl-2.5">
                  Acceso privado
                </div>
              </div>
            </div>

            {/* Vista previa interactiva fiel al producto real */}
            <div className="lg:col-span-7 flex">
              <div className="w-full bg-surface-container-lowest border border-outline-variant/60 rounded-xl shadow-xs flex flex-col justify-between overflow-hidden">
                {/* Barra superior del simulador */}
                <div className="px-4 sm:px-6 py-4 border-b border-outline-variant/40 bg-surface-container-low/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-on-background">
                      Vista previa del sistema
                    </p>
                    <p className="text-xs text-on-surface-variant">
                      Simulación interactiva con datos de ejemplo
                    </p>
                  </div>

                  {/* Selector funcional de módulos */}
                  <div
                    role="tablist"
                    aria-label="Vistas previas de módulos de VigorCore"
                    className="inline-flex items-center gap-1 p-1 rounded-lg bg-surface-container-low border border-outline-variant/50 self-start sm:self-auto"
                  >
                    {(
                      [
                        { id: 'nutricion', label: 'Nutrición' },
                        { id: 'mesociclo', label: 'Mesociclo' },
                        { id: 'analitica', label: 'Analítica' },
                      ] as const
                    ).map(tab => {
                      const active = previewTab === tab.id;
                      return (
                        <button
                          key={tab.id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setPreviewTab(tab.id)}
                          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                            active
                              ? 'bg-surface-container-lowest text-on-background shadow-2xs'
                              : 'text-on-surface-variant hover:text-on-background'
                          }`}
                        >
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Cuerpo interactivo de la vista previa */}
                <div className="p-4 sm:p-6 flex-1 flex flex-col justify-between gap-5">
                  {previewTab === 'nutricion' && (
                    <div className="space-y-5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                        <span className="text-xs font-medium text-on-surface-variant">
                          Perfil ilustrativo: 74,5 kg · 178 cm · PAL 1,55 (TDEE 2.651 kcal)
                        </span>
                        <div className="inline-flex items-center gap-1 bg-surface-container-low p-1 rounded-lg border border-outline-variant/40 self-start sm:self-auto">
                          {(['deficit', 'mantenimiento', 'superavit'] as const).map(mode => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setNutritionScenario(mode)}
                              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                                nutritionScenario === mode
                                  ? 'bg-primary text-on-primary'
                                  : 'text-on-surface-variant hover:text-on-background'
                              }`}
                            >
                              {PREVIEW_SCENARIOS[mode].shortLabel}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-4 border-y border-outline-variant/40">
                        <div>
                          <p className="text-xs text-on-surface-variant">Meta diaria</p>
                          <p className="font-landing-mono text-2xl font-semibold text-on-background mt-1">
                            {activeNutrition.targetKcal.toLocaleString('es-CO')}
                          </p>
                          <p className="text-[11px] text-on-surface-variant">kcal / día</p>
                        </div>
                        <div>
                          <p className="text-xs text-on-surface-variant">Proteína (2,0 g/kg)</p>
                          <p className="font-landing-mono text-2xl font-semibold text-primary mt-1">
                            {activeNutrition.proteinG}g
                          </p>
                          <p className="text-[11px] text-on-surface-variant">596 kcal fijas</p>
                        </div>
                        <div>
                          <p className="text-xs text-on-surface-variant">Grasas (0,8 g/kg)</p>
                          <p className="font-landing-mono text-2xl font-semibold text-on-background mt-1">
                            {activeNutrition.fatG}g
                          </p>
                          <p className="text-[11px] text-on-surface-variant">540 kcal fijas</p>
                        </div>
                        <div>
                          <p className="text-xs text-on-surface-variant">Carbohidratos</p>
                          <p className="font-landing-mono text-2xl font-semibold text-tertiary mt-1">
                            {activeNutrition.carbsG}g
                          </p>
                          <p className="text-[11px] text-on-surface-variant">Balance residual</p>
                        </div>
                      </div>

                      {/* Barra proporcional de energía */}
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                          <span className="font-medium text-on-background">
                            Proporción calórica · {activeNutrition.label}
                          </span>
                          <span className="font-landing-mono text-[11px] text-on-surface-variant whitespace-nowrap">
                            P {macroDistributionPct.protein}% · G {macroDistributionPct.fat}% · C{' '}
                            {macroDistributionPct.carbs}%
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-sm overflow-hidden flex bg-surface-container-low">
                          <div
                            className="bg-primary h-full transition-all duration-200"
                            style={{ width: `${macroDistributionPct.protein}%` }}
                          />
                          <div
                            className="bg-secondary h-full transition-all duration-200"
                            style={{ width: `${macroDistributionPct.fat}%` }}
                          />
                          <div
                            className="bg-tertiary h-full transition-all duration-200"
                            style={{ width: `${macroDistributionPct.carbs}%` }}
                          />
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-on-background">
                            Reparto por momento de comida
                          </span>
                          <span className="text-on-surface-variant">Plantilla configurable</span>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs font-landing-mono">
                          <div className="pt-2 border-t-2 border-primary">
                            <span className="block text-on-surface-variant font-landing-body">
                              Desayuno
                            </span>
                            <span className="font-semibold text-on-background">25%</span>
                          </div>
                          <div className="pt-2 border-t-2 border-primary-container">
                            <span className="block text-on-surface-variant font-landing-body">
                              Almuerzo
                            </span>
                            <span className="font-semibold text-on-background">35%</span>
                          </div>
                          <div className="pt-2 border-t-2 border-tertiary">
                            <span className="block text-on-surface-variant font-landing-body">
                              Merienda
                            </span>
                            <span className="font-semibold text-on-background">15%</span>
                          </div>
                          <div className="pt-2 border-t-2 border-secondary">
                            <span className="block text-on-surface-variant font-landing-body">
                              Cena
                            </span>
                            <span className="font-semibold text-on-background">25%</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {previewTab === 'mesociclo' && (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-on-background">
                            {activeMesocycle.title}
                          </p>
                          <p className="text-xs text-on-surface-variant">
                            {activeMesocycle.phaseNote}
                          </p>
                        </div>
                        <div className="inline-flex items-center gap-1 bg-surface-container-low p-1 rounded-lg border border-outline-variant/40">
                          {([1, 4] as const).map(week => (
                            <button
                              key={week}
                              type="button"
                              onClick={() => setMesocycleWeek(week)}
                              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary ${
                                mesocycleWeek === week
                                  ? 'bg-primary text-on-primary'
                                  : 'text-on-surface-variant hover:text-on-background'
                              }`}
                            >
                              {week === 1 ? 'Semana 1' : 'Semana 4 · Descarga'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="overflow-x-auto border-y border-outline-variant/40">
                        <table className="w-full text-left text-xs min-w-[480px]">
                          <thead>
                            <tr className="border-b border-outline-variant/40 text-on-surface-variant">
                              <th className="py-2.5 pr-3 font-medium">Ejercicio</th>
                              <th className="py-2.5 px-3 font-medium">Series x Reps</th>
                              <th className="py-2.5 px-3 font-medium">RIR objetivo</th>
                              <th className="py-2.5 px-3 font-medium">Carga</th>
                              <th className="py-2.5 pl-3 font-medium text-right">1RM est. (Epley)</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-outline-variant/30 font-landing-mono">
                            {activeMesocycle.sets.map(row => (
                              <tr key={row.name}>
                                <td className="py-2.5 pr-3 font-landing-body font-medium text-on-background">
                                  {row.name}
                                </td>
                                <td className="py-2.5 px-3 text-on-surface-variant">
                                  {row.scheme}
                                </td>
                                <td className="py-2.5 px-3 text-primary font-medium">{row.rir}</td>
                                <td className="py-2.5 px-3 text-on-background">{row.load}</td>
                                <td className="py-2.5 pl-3 text-right text-on-background">
                                  {row.est1Rm}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <p className="text-xs text-on-surface-variant leading-relaxed">
                        En sesión activa se registra cada serie con temporizador de descanso,
                        cálculo automático de 1RM Epley y cola offline aislada por usuario.
                      </p>
                    </div>
                  )}

                  {previewTab === 'analitica' && (
                    <div className="space-y-5">
                      <div className="grid grid-cols-3 gap-4 pb-4 border-b border-outline-variant/40">
                        <div>
                          <p className="text-xs text-on-surface-variant">Índice ACWR</p>
                          <p className="font-landing-mono text-2xl font-semibold text-primary mt-1">
                            1,08
                          </p>
                          <p className="text-[11px] text-on-surface-variant">
                            Ventana de carga estable
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-on-surface-variant">Tonelaje semanal</p>
                          <p className="font-landing-mono text-2xl font-semibold text-on-background mt-1">
                            16.400
                          </p>
                          <p className="text-[11px] text-on-surface-variant">kg efectivos</p>
                        </div>
                        <div>
                          <p className="text-xs text-on-surface-variant">Exportación</p>
                          <p className="font-landing-mono text-2xl font-semibold text-on-background mt-1">
                            CSV / PDF
                          </p>
                          <p className="text-[11px] text-on-surface-variant">
                            Resumen y detalle de series
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-on-background">
                            Progresión ilustrativa de tonelaje (4 semanas)
                          </span>
                          <span className="text-on-surface-variant">
                            4 sesiones completadas / sem.
                          </span>
                        </div>
                        <div className="space-y-2">
                          {WORKLOAD_SAMPLE_WEEKS.map(item => {
                            const widthPct = Math.round((item.tonnageKg / maxSampleTonnage) * 100);
                            return (
                              <div
                                key={item.week}
                                className="grid grid-cols-12 items-center gap-3 text-xs"
                              >
                                <span className="col-span-2 font-landing-mono text-on-surface-variant">
                                  {item.week}
                                </span>
                                <div className="col-span-7 h-2.5 bg-surface-container-low rounded-sm overflow-hidden">
                                  <div
                                    className="h-full bg-primary rounded-sm transition-all duration-200"
                                    style={{ width: `${widthPct}%` }}
                                  />
                                </div>
                                <span className="col-span-3 text-right font-landing-mono text-on-background">
                                  {item.formatted} kg
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Aviso transparente de datos ficticios de demostración */}
                  <div className="pt-3 border-t border-outline-variant/40 flex flex-wrap items-center justify-between gap-2 text-[11px] text-on-surface-variant">
                    <span>Datos ilustrativos de ejemplo (no representan usuarios reales)</span>
                    <span>Tu historial privado carga únicamente tras iniciar sesión</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* B. MÓDULOS DEL PRODUCTO */}
        <section
          id="modulos"
          className="border-t border-outline-variant/50 bg-surface-container-lowest py-16 sm:py-20"
        >
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs font-semibold tracking-wide text-primary">
                Módulos implementados
              </p>
              <h2
                className="font-landing-display text-2xl sm:text-3xl font-bold tracking-tight text-on-background"
                style={{ textWrap: 'balance' }}
              >
                Construido sobre cálculos verificables y ejecución diaria real.
              </h2>
              <p className="text-sm sm:text-base text-on-surface-variant leading-relaxed">
                Cada módulo presentado corresponde a vistas y motores ya desarrollados en
                VigorCore, separando cálculos automáticos de registros manuales.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {MODULE_ITEMS.map(mod => {
                const Icon = mod.icon;
                return (
                  <article
                    key={mod.number}
                    className={`${mod.span} bg-background border border-outline-variant/60 rounded-xl p-6 sm:p-7 flex flex-col justify-between gap-5`}
                  >
                    <div className="space-y-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="inline-flex items-center gap-2.5">
                          <span
                            className="w-9 h-9 rounded-lg bg-surface-container-low border border-outline-variant/50 text-primary inline-flex items-center justify-center shrink-0"
                            aria-hidden="true"
                          >
                            <Icon className="w-4 h-4" />
                          </span>
                          <span className="font-landing-mono text-xs font-semibold text-primary">
                            {mod.number}
                          </span>
                        </div>
                        <span className="text-[11px] font-medium text-on-surface-variant text-right">
                          {mod.scope}
                        </span>
                      </div>

                      <h3 className="font-landing-display text-lg font-bold text-on-background tracking-tight">
                        {mod.title}
                      </h3>

                      <p className="text-sm text-on-surface-variant leading-relaxed">
                        {mod.description}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* C. CONFIANZA Y TRANSPARENCIA */}
        <section id="confianza" className="border-t border-outline-variant/50 py-16 sm:py-20">
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-stretch">
              <div className="lg:col-span-6 flex">
                <div className="w-full rounded-xl overflow-hidden border border-outline-variant/60 bg-surface-container-low min-h-[260px] lg:min-h-[380px]">
                  {studioImageFailed ? (
                    <div className="w-full h-full flex flex-col items-center justify-center p-8 text-center bg-surface-container-low">
                      <p className="font-landing-display text-base font-semibold text-on-background">
                        Entorno VigorCore de fuerza y nutrición
                      </p>
                      <p className="text-xs text-on-surface-variant mt-1 max-w-xs">
                        Programación estructurada, planificación nutricional y aislamiento estricto de
                        datos por cuenta.
                      </p>
                    </div>
                  ) : (
                    <img
                      src={studioPreviewImg}
                      alt="Estudio minimalista de entrenamiento de fuerza con discos calibrados y banco de madera bajo luz natural"
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      onError={() => setStudioImageFailed(true)}
                      className="w-full h-full object-cover"
                    />
                  )}
                </div>
              </div>

              <div className="lg:col-span-6 flex flex-col justify-center space-y-6">
                <div className="space-y-3">
                  <p className="text-xs font-semibold tracking-wide text-primary">
                    Transparencia y modelo de acceso
                  </p>
                  <h2
                    className="font-landing-display text-2xl sm:text-3xl font-bold tracking-tight text-on-background"
                    style={{ textWrap: 'balance' }}
                  >
                    Espacio de acceso privado con separación estricta de datos.
                  </h2>
                  <p className="text-sm sm:text-base text-on-surface-variant leading-relaxed">
                    VigorCore está concebido como un entorno privado para atletas, entrenadores y
                    especialistas en nutrición autorizados, no como un directorio público abierto.
                  </p>
                </div>

                <div className="space-y-5 pt-2 border-t border-outline-variant/50">
                  <div>
                    <h3 className="text-sm font-semibold text-on-background">
                      Información pública separada de los registros privados
                    </h3>
                    <p className="text-sm text-on-surface-variant leading-relaxed mt-1">
                      Al visitar esta página inicial solo se muestran la descripción del producto y
                      una vista previa ilustrativa. Las biometrías, diarios, rutinas y registros
                      administrativos permanecen bloqueados hasta completar el inicio de sesión.
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-on-background">
                      Permisos diferenciados por rol e invitación
                    </h3>
                    <p className="text-sm text-on-surface-variant leading-relaxed mt-1">
                      La vista de atleta concentra la planificación y el registro personal, mientras
                      la gestión de usuarios e invitaciones valida reclamaciones de rol y códigos de
                      invitación dedicados.
                    </p>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-on-background">
                      Alcance honesto de integraciones pendientes
                    </h3>
                    <p className="text-sm text-on-surface-variant leading-relaxed mt-1">
                      Las sustituciones alimentarias utilizan un catálogo de equivalencias propio, el
                      módulo de cardio funciona con ingreso manual sin conexión automática con relojes
                      o bandas Bluetooth, y la transición de acceso hacia Catalyst Hosted Login en
                      la aplicación principal se mantiene pendiente frente al entorno aislado de
                      prueba.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* D. CÓMO FUNCIONA */}
        <section
          id="como-funciona"
          className="border-t border-outline-variant/50 bg-surface-container-lowest py-16 sm:py-20"
        >
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
            <div className="max-w-2xl space-y-3">
              <p className="text-xs font-semibold tracking-wide text-primary">Cómo funciona</p>
              <h2
                className="font-landing-display text-2xl sm:text-3xl font-bold tracking-tight text-on-background"
                style={{ textWrap: 'balance' }}
              >
                Tres pasos desde la configuración inicial hasta el seguimiento diario.
              </h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {WORKFLOW_STEPS.map(item => (
                <div key={item.step} className="pt-6 border-t border-outline-variant/60 space-y-3">
                  <span className="font-landing-mono text-sm font-semibold text-primary block">
                    {item.step}
                  </span>
                  <h3 className="font-landing-display text-lg font-bold text-on-background tracking-tight">
                    {item.title}
                  </h3>
                  <p className="text-sm text-on-surface-variant leading-relaxed">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* E. CIERRE Y ACCESO EXPLÍCITO */}
        <section id="acceso" className="border-t border-outline-variant/50 py-16 sm:py-20">
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8">
            <div className="bg-surface-container-low border border-outline-variant/60 rounded-xl p-8 sm:p-12 flex flex-col lg:flex-row lg:items-center justify-between gap-8">
              <div className="max-w-2xl space-y-3">
                <p className="text-xs font-semibold tracking-wide text-primary">Acceso privado</p>
                <h2
                  className="font-landing-display text-2xl sm:text-3xl font-bold tracking-tight text-on-background"
                  style={{ textWrap: 'balance' }}
                >
                  Continúa hacia tu espacio VigorCore o revisa sus capacidades antes de entrar.
                </h2>
                <p className="text-sm sm:text-base text-on-surface-variant leading-relaxed">
                  El inicio de sesión comienza únicamente cuando tú lo solicitas. Si ya cuentas con
                  acceso autorizado, ingresa directamente desde la pantalla de autenticación.
                </p>
              </div>

              <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-stretch sm:items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => scrollToSection('resumen')}
                  className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-primary hover:bg-primary-container text-on-primary text-sm font-semibold transition-colors duration-150 whitespace-nowrap cursor-pointer min-h-[44px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span>Descubrir VigorCore</span>
                </button>
                <button
                  type="button"
                  onClick={handleSignInAction}
                  className="inline-flex items-center justify-center gap-1.5 px-5 py-3 rounded-lg border border-outline-variant bg-surface-container-lowest hover:bg-surface-container text-on-background text-sm font-semibold transition-colors duration-150 whitespace-nowrap cursor-pointer min-h-[44px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span>
                    {isAuthenticated ? 'Ir a mi espacio privado' : 'Ya tengo acceso · Iniciar sesión'}
                  </span>
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Pie de página corporativo reutilizable */}
      <PublicFooter
        onNavigateSection={scrollToSection}
        onSignInAction={handleSignInAction}
        isAuthenticated={isAuthenticated}
      />
    </div>
  );
};
