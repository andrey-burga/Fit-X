/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Athlete Profile & Platform Personalization View (Increment 7A)
 * Allows authenticated athletes to inspect and modify their profile,
 * biometrics, training preferences, and nutritional goals across devices.
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

const COMMON_TIMEZONES = [
  { id: 'America/Bogota', label: 'Bogotá, Lima, Quito (UTC-5)' },
  { id: 'America/Mexico_City', label: 'Ciudad de México (UTC-6)' },
  { id: 'America/Buenos_Aires', label: 'Buenos Aires, Santiago (UTC-3)' },
  { id: 'America/New_York', label: 'Nueva York, Miami (UTC-5 / UTC-4)' },
  { id: 'Europe/Madrid', label: 'Madrid, Barcelona (UTC+1 / UTC+2)' },
];

const GOAL_OPTIONS: { id: AthleteGoal; label: string; desc: string; icon: string }[] = [
  { id: 'perdida_grasa', label: 'Pérdida de Grasa', desc: 'Déficit calórico moderado (-400 kcal) y retención magra', icon: 'local_fire_department' },
  { id: 'ganancia_muscular', label: 'Hipertrofia / Ganancia Muscular', desc: 'Superávit calórico controlado (+300 kcal)', icon: 'fitness_center' },
  { id: 'mantenimiento', label: 'Mantenimiento & Recomposición', desc: 'Balance isocalórico para ganar densidad muscular', icon: 'balance' },
  { id: 'rendimiento', label: 'Rendimiento y Fuerza', desc: 'Presupuesto energético enfocado en potencia deportiva', icon: 'trending_up' },
  { id: 'salud_general', label: 'Salud General y Longevidad', desc: 'Adherencia sostenible y vitalidad metabólica', icon: 'favorite' },
];

export const AthleteProfileView: React.FC = () => {
  const {
    currentUser,
    biometrics,
    updateBiometrics,
    athletePreferences,
    updateAthletePreferences,
    updateAthleteProfile,
    mealPartition,
    updateMealPartition,
    isDemoMode,
    logout,
    isLoggingOut,
    showToast,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'perfil' | 'biometria' | 'entrenamiento' | 'nutricion' | 'regional'>('perfil');

  // Tab 1: Profile form
  const [name, setName] = useState(currentUser?.name || '');
  const [avatarUrl, setAvatarUrl] = useState(currentUser?.avatarUrl || '');
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  // Tab 2: Biometrics form
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(athletePreferences.weightUnit || 'kg');
  const [heightUnit, setHeightUnit] = useState<HeightUnit>(athletePreferences.heightUnit || 'cm');
  const [displayWeight, setDisplayWeight] = useState<number>(() => {
    return fromCanonicalKg(biometrics.weightKg || 74.5, athletePreferences.weightUnit || 'kg');
  });
  const [displayHeight, setDisplayHeight] = useState<number>(() => {
    return fromCanonicalCm(biometrics.heightCm || 178, athletePreferences.heightUnit || 'cm');
  });
  const [age, setAge] = useState(biometrics.age || 28);
  const [bodyFat, setBodyFat] = useState(biometrics.bodyFatPct || 15);
  const [pal, setPal] = useState(biometrics.palFactor || 1.55);
  const [isSavingBiometrics, setIsSavingBiometrics] = useState(false);

  // Tab 3: Training Preferences
  const [trainingDays, setTrainingDays] = useState(athletePreferences.trainingDaysPerWeek || 4);
  const [experience, setExperience] = useState<TrainingExperience>(athletePreferences.trainingExperience || 'intermedio');
  const [goal, setGoal] = useState<AthleteGoal>(currentUser?.goal || 'ganancia_muscular');
  const [equipment, setEquipment] = useState<string[]>(athletePreferences.availableEquipment || ['barra', 'mancuerna', 'polea', 'maquina', 'peso_corporal']);
  const [isSavingTraining, setIsSavingTraining] = useState(false);

  // Tab 4: Nutrition Preferences
  const [mealsPerDay, setMealsPerDay] = useState(athletePreferences.mealsPerDay || 4);
  const [dietaryPreference, setDietaryPreference] = useState<DietaryPreference>(athletePreferences.dietaryPreference || 'omnivoro');
  const [excludedFoods, setExcludedFoods] = useState(athletePreferences.excludedFoods ? athletePreferences.excludedFoods.join(', ') : '');
  const [desayunoPct, setDesayunoPct] = useState(mealPartition.desayunoPct);
  const [almuerzoPct, setAlmuerzoPct] = useState(mealPartition.almuerzoPct);
  const [meriendaPct, setMeriendaPct] = useState(mealPartition.meriendaPct);
  const [cenaPct, setCenaPct] = useState(mealPartition.cenaPct);
  const [isSavingNutrition, setIsSavingNutrition] = useState(false);

  // Tab 5: Regional Settings
  const [timezone, setTimezone] = useState(athletePreferences.timezone || 'America/Bogota');
  const [isSavingRegional, setIsSavingRegional] = useState(false);

  // Canonical calculations
  const canonicalKg = useMemo(() => toCanonicalKg(displayWeight, weightUnit), [displayWeight, weightUnit]);
  const canonicalCm = useMemo(() => toCanonicalCm(displayHeight, heightUnit), [displayHeight, heightUnit]);

  const previewMetrics = useMemo(() => {
    const validKg = canonicalKg > 0 ? canonicalKg : 70;
    const validCm = canonicalCm > 50 ? canonicalCm : 175;
    const bmr = Math.round(10 * validKg + 6.25 * validCm - 5 * age + 5);
    const tdee = Math.round(bmr * pal);
    const bmi = Math.round((validKg / Math.pow(validCm / 100, 2)) * 10) / 10;
    return { bmr, tdee, bmi };
  }, [canonicalKg, canonicalCm, age, pal]);

  // Unit conversions
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

  // Actions
  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('Por favor ingresa un nombre válido.', 'warning');
      return;
    }
    setIsSavingProfile(true);
    await updateAthleteProfile({
      name: name.trim(),
      avatarUrl: avatarUrl.trim() || currentUser?.avatarUrl,
    });
    setIsSavingProfile(false);
  };

  const handleSaveBiometrics = async (e: React.FormEvent) => {
    e.preventDefault();
    if (canonicalKg <= 30 || canonicalKg >= 300) {
      showToast('El peso corporal debe estar entre 30 y 300 kg.', 'warning');
      return;
    }
    if (canonicalCm <= 100 || canonicalCm >= 250) {
      showToast('La estatura debe estar entre 100 y 250 cm.', 'warning');
      return;
    }
    setIsSavingBiometrics(true);
    await updateBiometrics({
      weightKg: canonicalKg,
      heightCm: canonicalCm,
      age,
      bodyFatPct: bodyFat,
      palFactor: pal,
    });
    await updateAthletePreferences({
      weightUnit,
      heightUnit,
    });
    setIsSavingBiometrics(false);
  };

  const handleSaveTraining = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingTraining(true);
    await updateAthletePreferences({
      trainingDaysPerWeek: trainingDays,
      trainingExperience: experience,
      availableEquipment: equipment,
    });
    await updateAthleteProfile({
      goal,
    });
    setIsSavingTraining(false);
  };

  const handleSaveNutrition = async (e: React.FormEvent) => {
    e.preventDefault();
    const sum = desayunoPct + almuerzoPct + meriendaPct + cenaPct;
    if (sum !== 100) {
      showToast(`La distribución de comidas debe sumar 100% (suma actual: ${sum}%).`, 'warning');
      return;
    }

    setIsSavingNutrition(true);
    const excludedArray = excludedFoods.split(',').map(s => s.trim()).filter(Boolean);
    await updateAthletePreferences({
      mealsPerDay,
      dietaryPreference,
      excludedFoods: excludedArray,
    });
    updateMealPartition({
      desayunoPct,
      almuerzoPct,
      meriendaPct,
      cenaPct,
    });
    setIsSavingNutrition(false);
  };

  const handleSaveRegional = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingRegional(true);
    await updateAthletePreferences({
      timezone,
      weightUnit,
      heightUnit,
    });
    await updateAthleteProfile({
      location: timezone,
    });
    setIsSavingRegional(false);
  };

  return (
    <div className="p-4 sm:p-gutter-desktop max-w-[1440px] mx-auto w-full animate-in fade-in duration-150 flex flex-col gap-space-lg">
      {/* Header Banner */}
      <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-surface-container/40">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold text-primary uppercase tracking-wider bg-primary-fixed/30 px-2.5 py-0.5 rounded-full">
              SaaS Perfil &amp; Preferencias
            </span>
            <span className="text-xs text-on-surface-variant flex items-center gap-1">
              <span className="material-symbols-outlined text-xs text-primary">verified</span>
              {isDemoMode ? 'Modo Demostración' : 'Cloud Firestore Sincronizado'}
            </span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-on-surface">
            Perfil del Atleta
          </h1>
          <p className="text-xs sm:text-sm text-on-surface-variant max-w-2xl mt-0.5">
            Configuración de identidad, biometría metabólica, objetivos deportivos y preferencias del sistema.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={logout}
            disabled={isLoggingOut}
            className="px-3 py-1.5 bg-error-container/20 hover:bg-error-container/40 text-error rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-base">logout</span>
            <span>{isLoggingOut ? 'Cerrando...' : 'Cerrar Sesión'}</span>
          </button>
        </div>
      </section>

      {/* Profile Overview Card */}
      <div className="p-4 sm:p-5 bg-surface-container-low rounded-2xl border border-surface-container/60 flex flex-col sm:flex-row items-center sm:items-start justify-between gap-4">
        <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
          <img
            src={currentUser?.avatarUrl}
            alt={currentUser?.name}
            className="w-16 h-16 rounded-2xl object-cover ring-2 ring-primary shadow-sm shrink-0"
          />
          <div>
            <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
              <h2 className="text-lg font-bold text-on-surface">{currentUser?.name}</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary text-on-primary">
                {currentUser?.role}
              </span>
            </div>
            <span className="text-xs text-on-surface-variant block mt-0.5 font-mono">{currentUser?.email}</span>
            <div className="flex items-center justify-center sm:justify-start gap-3 text-[11px] text-on-surface-variant mt-1.5">
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-xs text-primary">schedule</span>
                {currentUser?.location || 'Bogotá (UTC-5)'}
              </span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <span className="material-symbols-outlined text-xs text-primary">calendar_month</span>
                Desde {currentUser?.joinedDate}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-center shrink-0 w-full sm:w-auto">
          <div className="p-2.5 bg-surface-container-lowest rounded-xl border border-surface-container">
            <span className="text-[10px] uppercase font-semibold text-on-surface-variant block">Peso Actual</span>
            <span className="text-sm font-bold font-mono text-on-surface mt-0.5 block">
              {formatWeight(biometrics.weightKg, weightUnit)}
            </span>
          </div>
          <div className="p-2.5 bg-surface-container-lowest rounded-xl border border-surface-container">
            <span className="text-[10px] uppercase font-semibold text-on-surface-variant block">Estatura</span>
            <span className="text-sm font-bold font-mono text-on-surface mt-0.5 block">
              {formatHeight(biometrics.heightCm, heightUnit)}
            </span>
          </div>
        </div>
      </div>

      {/* Tab Navigation Controls */}
      <div className="flex items-center gap-1 p-1 bg-surface-container-low rounded-xl overflow-x-auto">
        {[
          { id: 'perfil', label: 'Datos Básicos', icon: 'person' },
          { id: 'biometria', label: 'Biometría & Unidades', icon: 'monitor_weight' },
          { id: 'entrenamiento', label: 'Entrenamiento & Objetivos', icon: 'fitness_center' },
          { id: 'nutricion', label: 'Nutrición & Horarios', icon: 'restaurant' },
          { id: 'regional', label: 'Ajustes Regionales', icon: 'public' },
        ].map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-3 py-2 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === tab.id
                ? 'bg-surface-container-lowest text-on-surface shadow-xs font-bold'
                : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
            }`}
          >
            <span className={`material-symbols-outlined text-sm ${activeTab === tab.id ? 'text-primary' : ''}`}>
              {tab.icon}
            </span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* TAB 1: DATOS BÁSICOS */}
      {activeTab === 'perfil' && (
        <form onSubmit={handleSaveProfile} className="p-5 bg-surface-container-low rounded-2xl border border-surface-container flex flex-col gap-4 text-left">
          <div className="border-b border-surface-container/60 pb-2">
            <h3 className="text-sm font-bold text-on-surface">Información Básica de la Cuenta</h3>
            <p className="text-xs text-on-surface-variant">Datos sincronizados con tu identidad y perfil Cloud Firestore.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Nombre Completo</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 bg-surface-container-lowest border border-surface-container rounded-xl text-xs text-on-surface focus:outline-none focus:border-primary"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Correo Electrónico (Inmutable)</label>
              <input
                type="email"
                value={currentUser?.email || ''}
                disabled
                className="w-full px-3 py-2 bg-surface-container-high border border-surface-container rounded-xl text-xs text-on-surface-variant cursor-not-allowed font-mono opacity-80"
              />
              <span className="text-[10px] text-primary mt-1 block">Protegido por reglas de seguridad Firestore (Inmutable).</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">URL Fotografía de Perfil</label>
              <input
                type="url"
                value={avatarUrl}
                onChange={e => setAvatarUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 bg-surface-container-lowest border border-surface-container rounded-xl text-xs text-on-surface focus:outline-none focus:border-primary font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Rol de Acceso</label>
              <input
                type="text"
                value={currentUser?.role || 'Atleta Pro'}
                disabled
                className="w-full px-3 py-2 bg-surface-container-high border border-surface-container rounded-xl text-xs text-on-surface-variant cursor-not-allowed opacity-80"
              />
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={isSavingProfile}
              className="px-5 py-2 bg-primary hover:bg-primary-container text-on-primary rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">save</span>
              <span>{isSavingProfile ? 'Guardando...' : 'Guardar Cambios de Perfil'}</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 2: BIOMETRÍA & UNIDADES */}
      {activeTab === 'biometria' && (
        <form onSubmit={handleSaveBiometrics} className="p-5 bg-surface-container-low rounded-2xl border border-surface-container flex flex-col gap-4 text-left">
          <div className="border-b border-surface-container/60 pb-2 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-on-surface">Datos Biométricos y Unidades</h3>
              <p className="text-xs text-on-surface-variant">Almacenados en subcolección users/{'{uid}'}/biometrics/current.</p>
            </div>
            <div className="text-right">
              <span className="text-[11px] text-on-surface-variant block">IMC Calculado</span>
              <span className="text-xs font-mono font-bold text-primary">{previewMetrics.bmi} kg/m²</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Peso */}
            <div className="p-3 bg-surface-container-lowest rounded-xl border border-surface-container">
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
              <input
                type="number"
                step="0.1"
                value={displayWeight}
                onChange={e => setDisplayWeight(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 bg-surface-container-low border border-surface-container rounded-lg text-xs text-on-surface focus:outline-none focus:border-primary font-mono"
              />
              <span className="text-[10px] text-on-surface-variant mt-1 block">SI Canónico: {canonicalKg} kg</span>
            </div>

            {/* Estatura */}
            <div className="p-3 bg-surface-container-lowest rounded-xl border border-surface-container">
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
              <input
                type="number"
                step="0.5"
                value={displayHeight}
                onChange={e => setDisplayHeight(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 bg-surface-container-low border border-surface-container rounded-lg text-xs text-on-surface focus:outline-none focus:border-primary font-mono"
              />
              <span className="text-[10px] text-on-surface-variant mt-1 block">SI Canónico: {canonicalCm} cm</span>
            </div>

            {/* Edad & Grasa */}
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Edad (Años)</label>
              <input
                type="number"
                min="14"
                max="100"
                value={age}
                onChange={e => setAge(parseInt(e.target.value) || 28)}
                className="w-full px-3 py-2 bg-surface-container-lowest border border-surface-container rounded-xl text-xs text-on-surface focus:outline-none focus:border-primary font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Grasa Corporal (%)</label>
              <input
                type="number"
                step="0.5"
                min="3"
                max="50"
                value={bodyFat}
                onChange={e => setBodyFat(parseFloat(e.target.value) || 15)}
                className="w-full px-3 py-2 bg-surface-container-lowest border border-surface-container rounded-xl text-xs text-on-surface focus:outline-none focus:border-primary font-mono"
              />
            </div>

            {/* Factor PAL */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Nivel de Actividad (Factor PAL)</label>
              <select
                value={pal}
                onChange={e => setPal(parseFloat(e.target.value))}
                className="w-full px-3 py-2 bg-surface-container-lowest border border-surface-container rounded-xl text-xs text-on-surface focus:outline-none focus:border-primary"
              >
                <option value={1.2}>Sedentario (Factor 1.2 — Poca actividad)</option>
                <option value={1.375}>Ligero (Factor 1.375 — Ejercicio 1-2 días/sem)</option>
                <option value={1.55}>Moderado (Factor 1.55 — Fuerza 3-5 días/sem, recomendado)</option>
                <option value={1.725}>Intenso (Factor 1.725 — Entrenamiento diario o trabajo físico)</option>
              </select>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="p-3 bg-surface-container-lowest rounded-xl border border-surface-container flex items-center justify-between text-xs">
            <div>
              <span className="text-on-surface-variant block text-[10px] uppercase font-semibold">Tasa Basal (TMB)</span>
              <span className="font-mono font-bold text-on-surface">{previewMetrics.bmr} kcal</span>
            </div>
            <div>
              <span className="text-on-surface-variant block text-[10px] uppercase font-semibold">Gasto Total (TDEE)</span>
              <span className="font-mono font-bold text-on-surface">{previewMetrics.tdee} kcal</span>
            </div>
            <div>
              <span className="text-on-surface-variant block text-[10px] uppercase font-semibold">Presupuesto Actual</span>
              <span className="font-mono font-bold text-primary">{biometrics.targetCalories} kcal</span>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={isSavingBiometrics}
              className="px-5 py-2 bg-primary hover:bg-primary-container text-on-primary rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">save</span>
              <span>{isSavingBiometrics ? 'Guardando...' : 'Guardar Biometrías'}</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 3: ENTRENAMIENTO & OBJETIVOS */}
      {activeTab === 'entrenamiento' && (
        <form onSubmit={handleSaveTraining} className="p-5 bg-surface-container-low rounded-2xl border border-surface-container flex flex-col gap-4 text-left">
          <div className="border-b border-surface-container/60 pb-2">
            <h3 className="text-sm font-bold text-on-surface">Objetivo Deportivo &amp; Preferencias de Fuerza</h3>
            <p className="text-xs text-on-surface-variant">Parámetros utilizados por el asistente de autorregulación y rutinas.</p>
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">Objetivo Deportivo Principal</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {GOAL_OPTIONS.map(g => (
                  <div
                    key={g.id}
                    onClick={() => setGoal(g.id)}
                    className={`p-3 rounded-xl border cursor-pointer transition-all flex items-start gap-2.5 ${
                      goal === g.id
                        ? 'bg-primary/10 border-primary shadow-xs'
                        : 'bg-surface-container-lowest border-surface-container hover:bg-surface-container'
                    }`}
                  >
                    <span className="material-symbols-outlined text-primary text-lg shrink-0 mt-0.5">{g.icon}</span>
                    <div>
                      <span className="text-xs font-bold text-on-surface block">{g.label}</span>
                      <span className="text-[10px] text-on-surface-variant block mt-0.5">{g.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Días de Entrenamiento Semanales</label>
                <select
                  value={trainingDays}
                  onChange={e => setTrainingDays(parseInt(e.target.value))}
                  className="w-full px-3 py-2 bg-surface-container-lowest border border-surface-container rounded-xl text-xs text-on-surface focus:outline-none focus:border-primary"
                >
                  <option value={3}>3 días por semana</option>
                  <option value={4}>4 días por semana (Recomendado Torso/Pierna)</option>
                  <option value={5}>5 días por semana</option>
                  <option value={6}>6 días por semana (Push / Pull / Legs × 2)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-on-surface-variant mb-1">Nivel de Experiencia</label>
                <select
                  value={experience}
                  onChange={e => setExperience(e.target.value as TrainingExperience)}
                  className="w-full px-3 py-2 bg-surface-container-lowest border border-surface-container rounded-xl text-xs text-on-surface focus:outline-none focus:border-primary"
                >
                  <option value="principiante">Principiante (&lt; 1 año)</option>
                  <option value="intermedio">Intermedio (1 a 3 años)</option>
                  <option value="avanzado">Avanzado (&gt; 3 años)</option>
                </select>
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={isSavingTraining}
              className="px-5 py-2 bg-primary hover:bg-primary-container text-on-primary rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">save</span>
              <span>{isSavingTraining ? 'Guardando...' : 'Guardar Entrenamiento'}</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 4: NUTRICIÓN & HORARIOS */}
      {activeTab === 'nutricion' && (
        <form onSubmit={handleSaveNutrition} className="p-5 bg-surface-container-low rounded-2xl border border-surface-container flex flex-col gap-4 text-left">
          <div className="border-b border-surface-container/60 pb-2">
            <h3 className="text-sm font-bold text-on-surface">Estructura Nutricional y Partición de Comidas</h3>
            <p className="text-xs text-on-surface-variant">Configura el número de tomas y su distribución calórica diaria.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Tomas Diarias</label>
              <select
                value={mealsPerDay}
                onChange={e => setMealsPerDay(parseInt(e.target.value))}
                className="w-full px-3 py-2 bg-surface-container-lowest border border-surface-container rounded-xl text-xs text-on-surface focus:outline-none focus:border-primary"
              >
                <option value={3}>3 Comidas (Desayuno, Almuerzo, Cena)</option>
                <option value={4}>4 Comidas (Estándar con merienda)</option>
                <option value={5}>5 Comidas (Mayor partición)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Estilo de Alimentación</label>
              <select
                value={dietaryPreference}
                onChange={e => setDietaryPreference(e.target.value as DietaryPreference)}
                className="w-full px-3 py-2 bg-surface-container-lowest border border-surface-container rounded-xl text-xs text-on-surface focus:outline-none focus:border-primary"
              >
                <option value="omnivoro">Omnívoro</option>
                <option value="pescetariano">Pescetariano</option>
                <option value="vegetariano">Vegetariano</option>
                <option value="vegano">Vegano</option>
                <option value="sin_gluten">Sin Gluten</option>
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Exclusiones o Alimentos Rechazados</label>
              <input
                type="text"
                value={excludedFoods}
                onChange={e => setExcludedFoods(e.target.value)}
                placeholder="Ej: Lácteos, Mariscos, Frutos secos"
                className="w-full px-3 py-2 bg-surface-container-lowest border border-surface-container rounded-xl text-xs text-on-surface focus:outline-none focus:border-primary"
              />
            </div>
          </div>

          {/* Partición de Momentos */}
          <div className="p-3 bg-surface-container-lowest rounded-xl border border-surface-container">
            <span className="text-xs font-bold text-on-surface block mb-2">Distribución Porcentual del Presupuesto</span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="text-[11px] text-on-surface-variant block mb-1">Desayuno (%)</label>
                <input
                  type="number"
                  value={desayunoPct}
                  onChange={e => setDesayunoPct(parseInt(e.target.value) || 0)}
                  className="w-full px-2 py-1.5 bg-surface-container-low border border-surface-container rounded text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-on-surface-variant block mb-1">Almuerzo (%)</label>
                <input
                  type="number"
                  value={almuerzoPct}
                  onChange={e => setAlmuerzoPct(parseInt(e.target.value) || 0)}
                  className="w-full px-2 py-1.5 bg-surface-container-low border border-surface-container rounded text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-on-surface-variant block mb-1">Merienda (%)</label>
                <input
                  type="number"
                  value={meriendaPct}
                  onChange={e => setMeriendaPct(parseInt(e.target.value) || 0)}
                  className="w-full px-2 py-1.5 bg-surface-container-low border border-surface-container rounded text-xs font-mono"
                />
              </div>
              <div>
                <label className="text-[11px] text-on-surface-variant block mb-1">Cena (%)</label>
                <input
                  type="number"
                  value={cenaPct}
                  onChange={e => setCenaPct(parseInt(e.target.value) || 0)}
                  className="w-full px-2 py-1.5 bg-surface-container-low border border-surface-container rounded text-xs font-mono"
                />
              </div>
            </div>
            <div className="mt-2 text-right text-[11px] font-mono">
              Suma total: <span className={desayunoPct + almuerzoPct + meriendaPct + cenaPct === 100 ? 'text-primary font-bold' : 'text-error font-bold'}>{desayunoPct + almuerzoPct + meriendaPct + cenaPct}%</span> (debe ser 100%)
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={isSavingNutrition}
              className="px-5 py-2 bg-primary hover:bg-primary-container text-on-primary rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">save</span>
              <span>{isSavingNutrition ? 'Guardando...' : 'Guardar Nutrición'}</span>
            </button>
          </div>
        </form>
      )}

      {/* TAB 5: AJUSTES REGIONALES */}
      {activeTab === 'regional' && (
        <form onSubmit={handleSaveRegional} className="p-5 bg-surface-container-low rounded-2xl border border-surface-container flex flex-col gap-4 text-left">
          <div className="border-b border-surface-container/60 pb-2">
            <h3 className="text-sm font-bold text-on-surface">Ajustes Regionales y Zonas Horarias</h3>
            <p className="text-xs text-on-surface-variant">Configuración del huso horario para trazabilidad de comidas y entrenamientos.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Zona Horaria Principal</label>
              <select
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                className="w-full px-3 py-2 bg-surface-container-lowest border border-surface-container rounded-xl text-xs text-on-surface focus:outline-none focus:border-primary"
              >
                {COMMON_TIMEZONES.map(tz => (
                  <option key={tz.id} value={tz.id}>
                    {tz.label}
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-on-surface-variant mt-1 block">
                Detectada en navegador: {Intl.DateTimeFormat().resolvedOptions().timeZone}
              </span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1">Unidades por Defecto</label>
              <div className="flex items-center gap-3 pt-2 text-xs">
                <span className="text-on-surface font-mono">Peso: {weightUnit}</span>
                <span>·</span>
                <span className="text-on-surface font-mono">Estatura: {heightUnit}</span>
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="submit"
              disabled={isSavingRegional}
              className="px-5 py-2 bg-primary hover:bg-primary-container text-on-primary rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-sm">save</span>
              <span>{isSavingRegional ? 'Guardando...' : 'Guardar Ajustes'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
};
