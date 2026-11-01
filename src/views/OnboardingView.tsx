/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Onboarding Wizard Component (Increment 7A)
 * Guides new athletes through profile setup, biometrics, goals,
 * training preferences, and nutrition preferences with Zero-Trust persistence.
 */

import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  WeightUnit,
  HeightUnit,
  AthleteGoal,
  TrainingExperience,
  DietaryPreference,
} from '../types/auth';
import {
  toCanonicalKg,
  toCanonicalCm,
  fromCanonicalKg,
  fromCanonicalCm,
  formatWeight,
  formatHeight,
} from '../services/unitConversion';

const GOAL_OPTIONS: {
  id: AthleteGoal;
  title: string;
  subtitle: string;
  deltaKcal: number;
  proteinPerKg: number;
  fatPerKg: number;
  icon: string;
}[] = [
  {
    id: 'perdida_grasa',
    title: 'Pérdida de Grasa',
    subtitle: 'Déficit calórico moderado (-400 kcal) priorizando preservación de masa muscular.',
    deltaKcal: -400,
    proteinPerKg: 2.2,
    fatPerKg: 0.8,
    icon: 'local_fire_department',
  },
  {
    id: 'ganancia_muscular',
    title: 'Ganancia Muscular / Hipertrofia',
    subtitle: 'Superávit calórico controlado (+300 kcal) para optimizar síntesis proteica.',
    deltaKcal: 300,
    proteinPerKg: 2.0,
    fatPerKg: 0.9,
    icon: 'fitness_center',
  },
  {
    id: 'mantenimiento',
    title: 'Mantenimiento & Recomposición',
    subtitle: 'Balance isocalórico (0 kcal) para ganar densidad muscular mientras se reduce grasa.',
    deltaKcal: 0,
    proteinPerKg: 2.0,
    fatPerKg: 0.85,
    icon: 'balance',
  },
  {
    id: 'rendimiento',
    title: 'Mejora del Rendimiento Deportivo',
    subtitle: 'Presupuesto energético optimizado para fuerza máxima y resistencia neuromuscular.',
    deltaKcal: 150,
    proteinPerKg: 2.1,
    fatPerKg: 0.9,
    icon: 'trending_up',
  },
  {
    id: 'salud_general',
    title: 'Salud General y Condición Física',
    subtitle: 'Adherencia a largo plazo, balance metabólico y vitalidad sostenida.',
    deltaKcal: 0,
    proteinPerKg: 1.8,
    fatPerKg: 0.8,
    icon: 'favorite',
  },
];

const PAL_OPTIONS = [
  { factor: 1.2, label: 'Sedentario', desc: 'Trabajo de escritorio, poco movimiento diario' },
  { factor: 1.375, label: 'Ligero', desc: 'Actividad ligera o ejercicio 1-2 días por semana' },
  { factor: 1.55, label: 'Moderado (Recomendado)', desc: 'Entrenamiento de fuerza 3-5 días por semana' },
  { factor: 1.725, label: 'Intenso', desc: 'Entrenamiento intenso diario o trabajo físico demandante' },
];

const EQUIPMENT_OPTIONS = [
  { id: 'barra', label: 'Barra olímpica y discos' },
  { id: 'mancuerna', label: 'Mancuernas ajustables o fijas' },
  { id: 'polea', label: 'Torre de poleas y cables' },
  { id: 'maquina', label: 'Máquinas guiadas y de palanca' },
  { id: 'peso_corporal', label: 'Peso corporal / Calistenia' },
  { id: 'bandas', label: 'Bandas elásticas y accesorios' },
];

const MUSCLE_FOCUS_OPTIONS = [
  { id: 'pecho', label: 'Pecho / Pectoral' },
  { id: 'espalda', label: 'Espalda y Dorsales' },
  { id: 'hombros', label: 'Hombros / Deltoides' },
  { id: 'cuadriceps', label: 'Pierna / Cuádriceps' },
  { id: 'isquios', label: 'Isquiotibiales y Glúteos' },
  { id: 'biceps', label: 'Brazos (Bíceps y Tríceps)' },
];

export const OnboardingView: React.FC = () => {
  const {
    currentUser,
    biometrics,
    athletePreferences,
    completeOnboarding,
    saveOnboardingStep,
    logout,
    isLoggingOut,
  } = useApp();

  // Wizard Step State (1 to 6)
  const [currentStep, setCurrentStep] = useState<number>(() => {
    return currentUser?.onboardingStep && currentUser.onboardingStep >= 1 && currentUser.onboardingStep <= 6
      ? currentUser.onboardingStep
      : 1;
  });

  // Step 2 Form States
  const [fullName, setFullName] = useState<string>(currentUser?.name || 'Atleta Vigor');
  const [age, setAge] = useState<number>(biometrics.age || 28);
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(athletePreferences.weightUnit || 'kg');
  const [heightUnit, setHeightUnit] = useState<HeightUnit>(athletePreferences.heightUnit || 'cm');
  const [displayWeight, setDisplayWeight] = useState<number>(() => {
    return fromCanonicalKg(biometrics.weightKg || 74.5, athletePreferences.weightUnit || 'kg');
  });
  const [displayHeight, setDisplayHeight] = useState<number>(() => {
    return fromCanonicalCm(biometrics.heightCm || 178, athletePreferences.heightUnit || 'cm');
  });
  const [bodyFat, setBodyFat] = useState<number>(biometrics.bodyFatPct || 15);
  const [palFactor, setPalFactor] = useState<number>(biometrics.palFactor || 1.55);

  // Step 3 Form States
  const [selectedGoal, setSelectedGoal] = useState<AthleteGoal>(() => {
    return currentUser?.goal || 'ganancia_muscular';
  });

  // Step 4 Form States
  const [trainingDays, setTrainingDays] = useState<number>(athletePreferences.trainingDaysPerWeek || 4);
  const [experience, setExperience] = useState<TrainingExperience>(athletePreferences.trainingExperience || 'intermedio');
  const [equipment, setEquipment] = useState<string[]>(athletePreferences.availableEquipment || ['barra', 'mancuerna', 'polea', 'maquina', 'peso_corporal']);
  const [trainingGoal, setTrainingGoal] = useState<AthleteGoal>(athletePreferences.trainingGoal || 'hipertrofia');
  const [muscleFocus, setMuscleFocus] = useState<string[]>(athletePreferences.muscleFocus || ['pecho', 'espalda', 'cuadriceps']);

  // Step 5 Form States
  const [mealsPerDay, setMealsPerDay] = useState<number>(athletePreferences.mealsPerDay || 4);
  const [dietaryPreference, setDietaryPreference] = useState<DietaryPreference>(athletePreferences.dietaryPreference || 'omnivoro');
  const [excludedFoodsText, setExcludedFoodsText] = useState<string>(
    athletePreferences.excludedFoods ? athletePreferences.excludedFoods.join(', ') : ''
  );

  // Submission & Validation States
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [stepError, setStepError] = useState<string | null>(null);

  // Handle unit switch
  const handleWeightUnitChange = (newUnit: WeightUnit) => {
    if (newUnit === weightUnit) return;
    const currentCanonical = toCanonicalKg(displayWeight, weightUnit);
    const converted = fromCanonicalKg(currentCanonical, newUnit);
    setWeightUnit(newUnit);
    setDisplayWeight(converted);
  };

  const handleHeightUnitChange = (newUnit: HeightUnit) => {
    if (newUnit === heightUnit) return;
    const currentCanonical = toCanonicalCm(displayHeight, heightUnit);
    const converted = fromCanonicalCm(currentCanonical, newUnit);
    setHeightUnit(newUnit);
    setDisplayHeight(converted);
  };

  // Canonical calculations in real-time
  const canonicalKg = useMemo(() => toCanonicalKg(displayWeight, weightUnit), [displayWeight, weightUnit]);
  const canonicalCm = useMemo(() => toCanonicalCm(displayHeight, heightUnit), [displayHeight, heightUnit]);

  const activeGoalConfig = useMemo(() => {
    return GOAL_OPTIONS.find(g => g.id === selectedGoal) || GOAL_OPTIONS[1];
  }, [selectedGoal]);

  const previewMetrics = useMemo(() => {
    const validKg = canonicalKg > 0 ? canonicalKg : 70;
    const validCm = canonicalCm > 50 ? canonicalCm : 175;
    const validAge = age > 10 ? age : 28;

    // Ecuación Mifflin-St Jeor
    const bmr = Math.round(10 * validKg + 6.25 * validCm - 5 * validAge + 5);
    const tdee = Math.round(bmr * palFactor);
    const targetKcal = Math.max(1200, tdee + activeGoalConfig.deltaKcal);
    const targetProteinG = Math.round(validKg * activeGoalConfig.proteinPerKg);
    const targetFatG = Math.round(validKg * activeGoalConfig.fatPerKg);
    const targetCarbsG = Math.max(50, Math.round((targetKcal - targetProteinG * 4 - targetFatG * 9) / 4));

    const proteinKcal = targetProteinG * 4;
    const fatKcal = targetFatG * 9;
    const carbsKcal = targetCarbsG * 4;
    const totalMacroKcal = proteinKcal + fatKcal + carbsKcal;

    const pPct = Math.round((proteinKcal / totalMacroKcal) * 100);
    const fPct = Math.round((fatKcal / totalMacroKcal) * 100);
    const cPct = Math.max(0, 100 - pPct - fPct);

    const bmi = Math.round((validKg / Math.pow(validCm / 100, 2)) * 10) / 10;

    return {
      bmr,
      tdee,
      targetKcal,
      targetProteinG,
      targetFatG,
      targetCarbsG,
      pPct,
      fPct,
      cPct,
      bmi,
    };
  }, [canonicalKg, canonicalCm, age, palFactor, activeGoalConfig]);

  // Step Validation & Navigation
  const validateStep = (step: number): boolean => {
    setStepError(null);
    if (step === 2) {
      if (!fullName.trim() || fullName.trim().length < 2) {
        setStepError('Ingresa un nombre válido de al menos 2 caracteres.');
        return false;
      }
      if (canonicalKg <= 30 || canonicalKg >= 300) {
        setStepError(`El peso ingresado (${displayWeight} ${weightUnit}) no está en un rango válido (30-300 kg).`);
        return false;
      }
      if (canonicalCm <= 100 || canonicalCm >= 250) {
        setStepError(`La estatura ingresada (${displayHeight} ${heightUnit}) no está en un rango válido (100-250 cm).`);
        return false;
      }
      if (age < 14 || age > 100) {
        setStepError('Ingresa una edad válida entre 14 y 100 años.');
        return false;
      }
    } else if (step === 4) {
      if (equipment.length === 0) {
        setStepError('Selecciona al menos un tipo de equipamiento disponible.');
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (!validateStep(currentStep)) return;
    const next = Math.min(6, currentStep + 1);
    setCurrentStep(next);

    // Save partial progress for multi-device recovery
    saveOnboardingStep(next, {
      profile: { name: fullName.trim(), goal: selectedGoal },
      preferences: {
        weightUnit,
        heightUnit,
        trainingDaysPerWeek: trainingDays,
        trainingExperience: experience,
        availableEquipment: equipment,
        trainingGoal,
        muscleFocus,
        mealsPerDay,
        dietaryPreference,
      },
      biometrics: {
        weightKg: canonicalKg,
        heightCm: canonicalCm,
        age,
        palFactor,
        bodyFatPct: bodyFat,
      },
    });
  };

  const handleBack = () => {
    setStepError(null);
    const prev = Math.max(1, currentStep - 1);
    setCurrentStep(prev);
  };

  const handleFinalSubmit = async () => {
    setIsSubmitting(true);
    setStepError(null);

    const excludedArray = excludedFoodsText
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const result = await completeOnboarding({
      profile: {
        name: fullName.trim(),
        goal: selectedGoal,
        location: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Bogotá (UTC-5)',
      },
      biometrics: {
        weightKg: canonicalKg,
        heightCm: canonicalCm,
        age,
        bodyFatPct: bodyFat,
        palFactor,
        targetDeltaKcal: activeGoalConfig.deltaKcal,
        proteinPerKg: activeGoalConfig.proteinPerKg,
        fatPerKg: activeGoalConfig.fatPerKg,
        targetCalories: previewMetrics.targetKcal,
        targetProteinG: previewMetrics.targetProteinG,
        targetFatG: previewMetrics.targetFatG,
        targetCarbsG: previewMetrics.targetCarbsG,
        bmr: previewMetrics.bmr,
        tdee: previewMetrics.tdee,
      },
      preferences: {
        weightUnit,
        heightUnit,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota',
        trainingDaysPerWeek: trainingDays,
        trainingExperience: experience,
        availableEquipment: equipment,
        trainingGoal,
        muscleFocus,
        mealsPerDay,
        dietaryPreference,
        excludedFoods: excludedArray,
        onboardingCompleted: true,
        onboardingStep: 6,
      },
    });

    setIsSubmitting(false);
    if (!result.success) {
      setStepError(result.error || 'No se pudo guardar la configuración. Reintenta.');
    }
  };

  return (
    <div className="min-h-screen bg-surface flex flex-col items-center justify-center p-3 sm:p-6 text-on-surface antialiased font-body-md selection:bg-primary-fixed selection:text-on-primary-fixed">
      <div className="w-full max-w-3xl bg-surface-container-lowest rounded-2xl shadow-xl border border-surface-container/60 overflow-hidden flex flex-col my-auto">
        
        {/* Wizard Header & Progress Bar */}
        <header className="p-4 sm:p-6 pb-4 border-b border-surface-container/40 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-on-primary font-bold shadow-xs">
                <span className="material-symbols-outlined text-lg">vital_signs</span>
              </div>
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-primary">VIGORCORE ONBOARDING</span>
                <span className="text-[11px] text-on-surface-variant block">Configuración Personalizada del Atleta</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-on-surface-variant">
                Paso {currentStep} de 6
              </span>
              <button
                type="button"
                onClick={logout}
                disabled={isLoggingOut}
                className="text-xs text-on-surface-variant hover:text-error transition-colors p-1 rounded"
                title="Cerrar sesión"
              >
                <span className="material-symbols-outlined text-base">logout</span>
              </button>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-primary h-full transition-all duration-300 rounded-full"
              style={{ width: `${(currentStep / 6) * 100}%` }}
            />
          </div>

          {/* Step Labels Indicator */}
          <div className="hidden sm:grid grid-cols-6 text-[10px] text-on-surface-variant font-medium text-center gap-1 pt-1">
            <span className={currentStep === 1 ? 'text-primary font-bold' : ''}>1. Bienvenida</span>
            <span className={currentStep === 2 ? 'text-primary font-bold' : ''}>2. Datos</span>
            <span className={currentStep === 3 ? 'text-primary font-bold' : ''}>3. Objetivos</span>
            <span className={currentStep === 4 ? 'text-primary font-bold' : ''}>4. Entrenamiento</span>
            <span className={currentStep === 5 ? 'text-primary font-bold' : ''}>5. Nutrición</span>
            <span className={currentStep === 6 ? 'text-primary font-bold' : ''}>6. Confirmación</span>
          </div>
        </header>

        {/* Step Error Notice */}
        {stepError && (
          <div className="mx-6 mt-4 p-3 bg-error-container/30 border border-error/30 rounded-xl text-error text-xs flex items-center gap-2">
            <span className="material-symbols-outlined text-base shrink-0">error</span>
            <span>{stepError}</span>
          </div>
        )}

        {/* Dynamic Step Body */}
        <main className="p-4 sm:p-8 flex-1 overflow-y-auto max-h-[70vh]">
          {/* PASO 1 — BIENVENIDA */}
          {currentStep === 1 && (
            <div className="flex flex-col gap-6 text-left">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-on-surface">
                  Bienvenido a VigorCore, {currentUser?.name || 'Atleta'}.
                </h2>
                <p className="text-sm text-on-surface-variant mt-1 leading-relaxed">
                  Tu ecosistema SaaS integral para optimizar rendimiento deportivo, recomposición corporal y longevidad metabólica.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div className="p-3.5 bg-surface-container-low rounded-xl border border-surface-container flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined text-lg">restaurant</span>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-on-surface">Nutrición de Precisión</h3>
                    <p className="text-[11px] text-on-surface-variant mt-0.5 leading-normal">
                      Cálculo de TDEE y distribución de macronutrientes basada en ecuaciones científicas (Mifflin-St Jeor).
                    </p>
                  </div>
                </div>

                <div className="p-3.5 bg-surface-container-low rounded-xl border border-surface-container flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined text-lg">calendar_view_week</span>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-on-surface">Planificación & Compras</h3>
                    <p className="text-[11px] text-on-surface-variant mt-0.5 leading-normal">
                      Menús semanales estructurados y consolidación idempotente de lista de insumos sin desperdicio.
                    </p>
                  </div>
                </div>

                <div className="p-3.5 bg-surface-container-low rounded-xl border border-surface-container flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined text-lg">fitness_center</span>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-on-surface">Entrenamiento en Vivo</h3>
                    <p className="text-[11px] text-on-surface-variant mt-0.5 leading-normal">
                      Registro de series en tiempo real, control de descanso y cálculo automático de tonelaje efectivo.
                    </p>
                  </div>
                </div>

                <div className="p-3.5 bg-surface-container-low rounded-xl border border-surface-container flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center text-primary shrink-0">
                    <span className="material-symbols-outlined text-lg">trending_up</span>
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-on-surface">Progresión & Autorregulación</h3>
                    <p className="text-[11px] text-on-surface-variant mt-0.5 leading-normal">
                      Monitoreo de 1RM estimado (Epley), sugerencias de sobrecarga asistida y detección de estancamientos.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-primary-container/10 border border-primary/20 rounded-xl text-xs text-on-surface-variant flex items-center gap-2.5">
                <span className="material-symbols-outlined text-primary text-base shrink-0">verified_user</span>
                <span>Tus datos se almacenarán con seguridad Zero-Trust en Cloud Firestore vinculados a tu cuenta.</span>
              </div>
            </div>
          )}

          {/* PASO 2 — INFORMACIÓN DEL ATLETA */}
          {currentStep === 2 && (
            <div className="flex flex-col gap-5 text-left">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-on-surface">
                  Información Biomecánica del Atleta
                </h2>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Estos datos son requeridos para los algoritmos nutricionales y de gasto metabólico.
                </p>
              </div>

              <div className="flex flex-col gap-4">
                {/* Nombre */}
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                    Nombre o Alias del Atleta <span className="text-primary">*</span>
                  </label>
                  <input
                    type="text"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                    placeholder="Ej: Camilo Rodríguez"
                    className="w-full px-3 py-2 bg-surface-container-low border border-surface-container rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary"
                    required
                  />
                </div>

                {/* Unidades & Medidas */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Selector Unidades Peso */}
                  <div className="p-3 bg-surface-container-low rounded-xl border border-surface-container">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-on-surface">Peso Corporal</label>
                      <div className="flex items-center gap-1 bg-surface-container p-0.5 rounded-lg text-xs font-medium">
                        <button
                          type="button"
                          onClick={() => handleWeightUnitChange('kg')}
                          className={`px-2 py-0.5 rounded ${weightUnit === 'kg' ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant'}`}
                        >
                          kg
                        </button>
                        <button
                          type="button"
                          onClick={() => handleWeightUnitChange('lbs')}
                          className={`px-2 py-0.5 rounded ${weightUnit === 'lbs' ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant'}`}
                        >
                          lbs
                        </button>
                      </div>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.1"
                        value={displayWeight}
                        onChange={e => setDisplayWeight(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-surface-container-lowest border border-surface-container rounded-lg text-sm text-on-surface focus:outline-none focus:border-primary font-mono"
                      />
                      <span className="absolute right-3 top-2.5 text-xs text-on-surface-variant font-mono">{weightUnit}</span>
                    </div>
                    <span className="text-[10px] text-on-surface-variant mt-1 block">
                      Almacenado como: {canonicalKg} kg
                    </span>
                  </div>

                  {/* Selector Unidades Estatura */}
                  <div className="p-3 bg-surface-container-low rounded-xl border border-surface-container">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-on-surface">Estatura</label>
                      <div className="flex items-center gap-1 bg-surface-container p-0.5 rounded-lg text-xs font-medium">
                        <button
                          type="button"
                          onClick={() => handleHeightUnitChange('cm')}
                          className={`px-2 py-0.5 rounded ${heightUnit === 'cm' ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant'}`}
                        >
                          cm
                        </button>
                        <button
                          type="button"
                          onClick={() => handleHeightUnitChange('in')}
                          className={`px-2 py-0.5 rounded ${heightUnit === 'in' ? 'bg-primary text-on-primary font-bold' : 'text-on-surface-variant'}`}
                        >
                          in
                        </button>
                      </div>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.5"
                        value={displayHeight}
                        onChange={e => setDisplayHeight(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 bg-surface-container-lowest border border-surface-container rounded-lg text-sm text-on-surface focus:outline-none focus:border-primary font-mono"
                      />
                      <span className="absolute right-3 top-2.5 text-xs text-on-surface-variant font-mono">{heightUnit}</span>
                    </div>
                    <span className="text-[10px] text-on-surface-variant mt-1 block">
                      Almacenado como: {canonicalCm} cm
                    </span>
                  </div>
                </div>

                {/* Edad & Grasa Corporal */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-on-surface-variant mb-1">
                      Edad (Años) <span className="text-primary">*</span>
                    </label>
                    <input
                      type="number"
                      min="14"
                      max="100"
                      value={age}
                      onChange={e => setAge(parseInt(e.target.value) || 28)}
                      className="w-full px-3 py-2 bg-surface-container-low border border-surface-container rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary font-mono"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-semibold text-on-surface-variant">
                        Grasa Corporal Estimada
                      </label>
                      <span className="text-[10px] text-primary">Opcional</span>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.5"
                        min="3"
                        max="50"
                        value={bodyFat}
                        onChange={e => setBodyFat(parseFloat(e.target.value) || 15)}
                        className="w-full px-3 py-2 bg-surface-container-low border border-surface-container rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary font-mono"
                      />
                      <span className="absolute right-3 top-2.5 text-xs text-on-surface-variant font-mono">%</span>
                    </div>
                  </div>
                </div>

                {/* Nivel de Actividad Diaria (PAL) */}
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                    Nivel de Actividad Diaria (Factor PAL)
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {PAL_OPTIONS.map(opt => (
                      <div
                        key={opt.factor}
                        onClick={() => setPalFactor(opt.factor)}
                        className={`p-2.5 rounded-xl border cursor-pointer transition-all ${
                          palFactor === opt.factor
                            ? 'bg-primary/10 border-primary shadow-xs'
                            : 'bg-surface-container-low border-surface-container hover:bg-surface-container'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-on-surface">{opt.label}</span>
                          <span className="text-[10px] font-mono font-semibold text-primary">×{opt.factor}</span>
                        </div>
                        <span className="text-[11px] text-on-surface-variant block mt-0.5 leading-tight">{opt.desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PASO 3 — OBJETIVOS */}
          {currentStep === 3 && (
            <div className="flex flex-col gap-5 text-left">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-on-surface">
                  Objetivo Principal del Atleta
                </h2>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  El motor calórico ajustará automáticamente tu balance energético y prescripción de macronutrientes.
                </p>
              </div>

              <div className="flex flex-col gap-2.5">
                {GOAL_OPTIONS.map(goal => (
                  <div
                    key={goal.id}
                    onClick={() => setSelectedGoal(goal.id)}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                      selectedGoal === goal.id
                        ? 'bg-primary/10 border-primary ring-1 ring-primary shadow-xs'
                        : 'bg-surface-container-low border-surface-container hover:bg-surface-container'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      selectedGoal === goal.id ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
                    }`}>
                      <span className="material-symbols-outlined text-xl">{goal.icon}</span>
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-on-surface">{goal.title}</span>
                        <span className={`text-[11px] font-semibold font-mono ${
                          goal.deltaKcal < 0 ? 'text-amber-500' : goal.deltaKcal > 0 ? 'text-emerald-500' : 'text-primary'
                        }`}>
                          {goal.deltaKcal > 0 ? `+${goal.deltaKcal}` : goal.deltaKcal} kcal/día
                        </span>
                      </div>
                      <p className="text-[11px] text-on-surface-variant mt-0.5 leading-snug">{goal.subtitle}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Real-time Target Summary */}
              <div className="p-3 bg-surface-container-low rounded-xl border border-surface-container flex items-center justify-between">
                <div>
                  <span className="text-[11px] text-on-surface-variant block uppercase font-semibold">Presupuesto Estimado</span>
                  <span className="text-sm font-bold text-on-surface mt-0.5 block">
                    {previewMetrics.targetKcal} kcal / día
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[11px] text-on-surface-variant block uppercase font-semibold">TDEE Mantenimiento</span>
                  <span className="text-sm font-mono text-on-surface-variant mt-0.5 block">
                    {previewMetrics.tdee} kcal
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* PASO 4 — PREFERENCIAS DE ENTRENAMIENTO */}
          {currentStep === 4 && (
            <div className="flex flex-col gap-5 text-left">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-on-surface">
                  Preferencias de Entrenamiento
                </h2>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Define tu disponibilidad y equipamiento. VigorCore no generará rutinas automáticas sin tu aprobación.
                </p>
              </div>

              <div className="flex flex-col gap-4">
                {/* Días por semana */}
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                    Frecuencia de Entrenamiento Semanal
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[3, 4, 5, 6].map(days => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setTrainingDays(days)}
                        className={`py-2 rounded-xl border text-xs font-semibold transition-all ${
                          trainingDays === days
                            ? 'bg-primary text-on-primary border-primary shadow-xs'
                            : 'bg-surface-container-low border-surface-container text-on-surface hover:bg-surface-container'
                        }`}
                      >
                        {days} días / sem
                      </button>
                    ))}
                  </div>
                </div>

                {/* Experiencia */}
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                    Experiencia en Entrenamiento de Fuerza
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { id: 'principiante', label: 'Principiante', sub: '< 1 año' },
                      { id: 'intermedio', label: 'Intermedio', sub: '1 - 3 años' },
                      { id: 'avanzado', label: 'Avanzado', sub: '> 3 años' },
                    ].map(exp => (
                      <button
                        key={exp.id}
                        type="button"
                        onClick={() => setExperience(exp.id as TrainingExperience)}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          experience === exp.id
                            ? 'bg-primary/10 border-primary'
                            : 'bg-surface-container-low border-surface-container hover:bg-surface-container'
                        }`}
                      >
                        <span className="text-xs font-bold text-on-surface block">{exp.label}</span>
                        <span className="text-[10px] text-on-surface-variant">{exp.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Equipamiento Disponible */}
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                    Equipamiento Disponible
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {EQUIPMENT_OPTIONS.map(item => {
                      const isSelected = equipment.includes(item.id);
                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            if (isSelected) {
                              setEquipment(equipment.filter(e => e !== item.id));
                            } else {
                              setEquipment([...equipment, item.id]);
                            }
                          }}
                          className={`p-2 rounded-xl border cursor-pointer text-xs flex items-center gap-2 transition-colors ${
                            isSelected
                              ? 'bg-primary/10 border-primary text-on-surface font-semibold'
                              : 'bg-surface-container-low border-surface-container text-on-surface-variant hover:bg-surface-container'
                          }`}
                        >
                          <span className={`material-symbols-outlined text-base ${isSelected ? 'text-primary' : 'text-on-surface-variant'}`}>
                            {isSelected ? 'check_box' : 'check_box_outline_blank'}
                          </span>
                          <span>{item.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Enfoque Muscular */}
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                    Grupos Musculares de Enfoque Prioritario
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {MUSCLE_FOCUS_OPTIONS.map(item => {
                      const isSelected = muscleFocus.includes(item.id);
                      return (
                        <div
                          key={item.id}
                          onClick={() => {
                            if (isSelected) {
                              setMuscleFocus(muscleFocus.filter(m => m !== item.id));
                            } else {
                              setMuscleFocus([...muscleFocus, item.id]);
                            }
                          }}
                          className={`p-2 rounded-xl border cursor-pointer text-xs flex items-center gap-2 transition-colors ${
                            isSelected
                              ? 'bg-primary/10 border-primary text-on-surface font-semibold'
                              : 'bg-surface-container-low border-surface-container text-on-surface-variant hover:bg-surface-container'
                          }`}
                        >
                          <span className={`material-symbols-outlined text-base ${isSelected ? 'text-primary' : 'text-on-surface-variant'}`}>
                            {isSelected ? 'check_circle' : 'radio_button_unchecked'}
                          </span>
                          <span>{item.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PASO 5 — PREFERENCIAS NUTRICIONALES */}
          {currentStep === 5 && (
            <div className="flex flex-col gap-5 text-left">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-on-surface">
                  Preferencias Nutricionales
                </h2>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Estructuración de comidas diarias y objetivos de macronutrientes calculados.
                </p>
              </div>

              <div className="flex flex-col gap-4">
                {/* Número de comidas */}
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                    Número de Comidas al Día
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { num: 3, label: '3 Comidas', sub: 'Desayuno, Almuerzo, Cena' },
                      { num: 4, label: '4 Comidas (Estándar)', sub: '+ Merienda proteica' },
                      { num: 5, label: '5 Comidas', sub: 'Mayor frecuencia y digestibilidad' },
                    ].map(opt => (
                      <button
                        key={opt.num}
                        type="button"
                        onClick={() => setMealsPerDay(opt.num)}
                        className={`p-2.5 rounded-xl border text-left transition-all ${
                          mealsPerDay === opt.num
                            ? 'bg-primary/10 border-primary'
                            : 'bg-surface-container-low border-surface-container hover:bg-surface-container'
                        }`}
                      >
                        <span className="text-xs font-bold text-on-surface block">{opt.label}</span>
                        <span className="text-[10px] text-on-surface-variant leading-tight block mt-0.5">{opt.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Estilo de Alimentación */}
                <div>
                  <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                    Estilo de Alimentación
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {[
                      { id: 'omnivoro', label: 'Omnívoro' },
                      { id: 'pescetariano', label: 'Pescetariano' },
                      { id: 'vegetariano', label: 'Vegetariano' },
                      { id: 'vegano', label: 'Vegano' },
                      { id: 'sin_gluten', label: 'Sin Gluten' },
                    ].map(style => (
                      <button
                        key={style.id}
                        type="button"
                        onClick={() => setDietaryPreference(style.id as DietaryPreference)}
                        className={`p-2 rounded-xl border text-xs font-semibold transition-all ${
                          dietaryPreference === style.id
                            ? 'bg-primary text-on-primary border-primary shadow-xs'
                            : 'bg-surface-container-low border-surface-container text-on-surface hover:bg-surface-container'
                        }`}
                      >
                        {style.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Alimentos Excluidos / Alergias */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-on-surface-variant">
                      Alimentos a Excluir o Alergias
                    </label>
                    <span className="text-[10px] text-primary">Opcional</span>
                  </div>
                  <input
                    type="text"
                    value={excludedFoodsText}
                    onChange={e => setExcludedFoodsText(e.target.value)}
                    placeholder="Ej: Lácteos, Mariscos, Frutos secos"
                    className="w-full px-3 py-2 bg-surface-container-low border border-surface-container rounded-xl text-sm text-on-surface focus:outline-none focus:border-primary"
                  />
                  <span className="text-[10px] text-on-surface-variant mt-1 block">
                    Separa múltiples exclusiones con comas.
                  </span>
                </div>

                {/* Previsualización de Macronutrientes */}
                <div className="p-3.5 bg-surface-container-low rounded-xl border border-surface-container">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-on-surface">Macronutrientes Objetivo</span>
                    <span className="text-xs font-mono font-bold text-primary">{previewMetrics.targetKcal} kcal</span>
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 bg-surface-container-lowest rounded-lg border border-surface-container/60">
                      <span className="text-[10px] uppercase font-semibold text-primary block">Proteínas</span>
                      <span className="text-sm font-bold font-mono text-on-surface mt-0.5 block">{previewMetrics.targetProteinG}g</span>
                      <span className="text-[10px] text-on-surface-variant font-mono">{previewMetrics.pPct}% kcal</span>
                    </div>
                    <div className="p-2 bg-surface-container-lowest rounded-lg border border-surface-container/60">
                      <span className="text-[10px] uppercase font-semibold text-amber-500 block">Carbohidratos</span>
                      <span className="text-sm font-bold font-mono text-on-surface mt-0.5 block">{previewMetrics.targetCarbsG}g</span>
                      <span className="text-[10px] text-on-surface-variant font-mono">{previewMetrics.cPct}% kcal</span>
                    </div>
                    <div className="p-2 bg-surface-container-lowest rounded-lg border border-surface-container/60">
                      <span className="text-[10px] uppercase font-semibold text-emerald-500 block">Grasas</span>
                      <span className="text-sm font-bold font-mono text-on-surface mt-0.5 block">{previewMetrics.targetFatG}g</span>
                      <span className="text-[10px] text-on-surface-variant font-mono">{previewMetrics.fPct}% kcal</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* PASO 6 — RESUMEN Y CONFIRMACIÓN */}
          {currentStep === 6 && (
            <div className="flex flex-col gap-5 text-left">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-on-surface">
                  Resumen de tu Configuración
                </h2>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  Verifica tus datos antes de persistir la configuración en Cloud Firestore.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Perfil & Biometría */}
                <div className="p-3 bg-surface-container-low rounded-xl border border-surface-container">
                  <div className="flex items-center justify-between border-b border-surface-container/60 pb-1.5 mb-2">
                    <span className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-primary">person</span>
                      Datos del Atleta
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(2)}
                      className="text-[11px] text-primary hover:underline font-semibold"
                    >
                      Editar
                    </button>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-on-surface-variant">Nombre:</span>
                      <span className="font-semibold text-on-surface">{fullName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-on-surface-variant">Peso:</span>
                      <span className="font-mono text-on-surface">{formatWeight(canonicalKg, weightUnit)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-on-surface-variant">Estatura:</span>
                      <span className="font-mono text-on-surface">{formatHeight(canonicalCm, heightUnit)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-on-surface-variant">Edad:</span>
                      <span className="font-mono text-on-surface">{age} años</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-on-surface-variant">IMC:</span>
                      <span className="font-mono text-on-surface">{previewMetrics.bmi} kg/m²</span>
                    </div>
                  </div>
                </div>

                {/* Plan Nutricional */}
                <div className="p-3 bg-surface-container-low rounded-xl border border-surface-container">
                  <div className="flex items-center justify-between border-b border-surface-container/60 pb-1.5 mb-2">
                    <span className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-primary">restaurant</span>
                      Objetivos Nutricionales
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(3)}
                      className="text-[11px] text-primary hover:underline font-semibold"
                    >
                      Editar
                    </button>
                  </div>
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-on-surface-variant">Objetivo:</span>
                      <span className="font-semibold text-primary">{activeGoalConfig.title}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-on-surface-variant">Calorías Diarias:</span>
                      <span className="font-mono font-bold text-on-surface">{previewMetrics.targetKcal} kcal</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-on-surface-variant">Proteínas:</span>
                      <span className="font-mono text-on-surface">{previewMetrics.targetProteinG}g ({previewMetrics.pPct}%)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-on-surface-variant">Carbohidratos:</span>
                      <span className="font-mono text-on-surface">{previewMetrics.targetCarbsG}g ({previewMetrics.cPct}%)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-on-surface-variant">Grasas:</span>
                      <span className="font-mono text-on-surface">{previewMetrics.targetFatG}g ({previewMetrics.fPct}%)</span>
                    </div>
                  </div>
                </div>

                {/* Preferencias de Entrenamiento */}
                <div className="p-3 bg-surface-container-low rounded-xl border border-surface-container sm:col-span-2">
                  <div className="flex items-center justify-between border-b border-surface-container/60 pb-1.5 mb-2">
                    <span className="text-xs font-bold text-on-surface flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-primary">fitness_center</span>
                      Entrenamiento & Preferencias
                    </span>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(4)}
                      className="text-[11px] text-primary hover:underline font-semibold"
                    >
                      Editar
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-on-surface-variant block text-[11px]">Frecuencia:</span>
                      <span className="font-semibold text-on-surface">{trainingDays} días por semana</span>
                    </div>
                    <div>
                      <span className="text-on-surface-variant block text-[11px]">Experiencia:</span>
                      <span className="font-semibold text-on-surface capitalize">{experience}</span>
                    </div>
                    <div>
                      <span className="text-on-surface-variant block text-[11px]">Comidas / Día:</span>
                      <span className="font-semibold text-on-surface">{mealsPerDay} tomas diarias ({dietaryPreference})</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-primary-container/10 border border-primary/20 rounded-xl text-xs text-on-surface-variant flex items-center gap-2.5">
                <span className="material-symbols-outlined text-primary text-base shrink-0">cloud_done</span>
                <span>Al confirmar, tus datos quedarán guardados en Cloud Firestore y accederás de inmediato a tu dashboard.</span>
              </div>
            </div>
          )}
        </main>

        {/* Wizard Footer Navigation Controls */}
        <footer className="p-4 sm:p-6 pt-3 border-t border-surface-container/40 flex items-center justify-between bg-surface-container-low/50">
          <div>
            {currentStep > 1 ? (
              <button
                type="button"
                onClick={handleBack}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-on-surface-variant hover:bg-surface-container transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-sm">arrow_back</span>
                <span>Anterior</span>
              </button>
            ) : (
              <div />
            )}
          </div>

          <div>
            {currentStep < 6 ? (
              <button
                type="button"
                onClick={handleNext}
                className="px-5 py-2.5 bg-primary hover:bg-primary-container text-on-primary rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5"
              >
                <span>{currentStep === 1 ? 'Comenzar Configuración' : 'Siguiente Paso'}</span>
                <span className="material-symbols-outlined text-sm">arrow_forward</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinalSubmit}
                disabled={isSubmitting}
                className="px-6 py-2.5 bg-primary hover:bg-primary-container text-on-primary rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                    <span>Guardando en Cloud Firestore...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-sm">check_circle</span>
                    <span>Confirmar y Entrar a VigorCore</span>
                  </>
                )}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};
