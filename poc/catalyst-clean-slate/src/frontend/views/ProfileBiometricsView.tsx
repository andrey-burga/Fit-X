/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Athlete Profile, Biometrics, Preferences & Guided Onboarding Wizard
 */

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ShieldAlert, Sparkles } from 'lucide-react';
import type {
  AthleteGoal,
  DietaryPreference,
  EquipmentRequired,
  TrainingExperience,
  WeightUnit,
} from '../contracts/cleanSlateModels';
import {
  cmToIn,
  computeBiometricTargets,
  formatHeight,
  formatWeight,
  inToCm,
  kgToLbs,
  lbsToKg,
} from '../domain/nutritionEngine';
import { useWorkspace } from '../state/WorkspaceContext';
import { InlineAlert, SectionCard, StatTile } from '../components/UiPrimitives';

const GOAL_OPTIONS: Array<{ value: AthleteGoal; label: string; delta: number; prot: number; fat: number }> = [
  { value: 'hipertrofia', label: 'Hipertrofia (+200 kcal)', delta: 200, prot: 2.0, fat: 0.9 },
  { value: 'definicion', label: 'Definición (-400 kcal)', delta: -400, prot: 2.4, fat: 0.7 },
  { value: 'recomposicion', label: 'Recomposición (-100 kcal)', delta: -100, prot: 2.2, fat: 0.8 },
  { value: 'fuerza', label: 'Fuerza Máxima (+100 kcal)', delta: 100, prot: 1.8, fat: 0.9 },
  { value: 'mantenimiento', label: 'Mantenimiento (0 kcal)', delta: 0, prot: 1.8, fat: 0.9 },
  { value: 'resistencia', label: 'Resistencia (+50 kcal)', delta: 50, prot: 1.7, fat: 0.85 },
];

const EQUIPMENT_LIST: Array<{ id: EquipmentRequired; label: string }> = [
  { id: 'barra', label: 'Barra olímpica' },
  { id: 'mancuerna', label: 'Mancuernas' },
  { id: 'polea', label: 'Poleas' },
  { id: 'maquina', label: 'Máquinas' },
  { id: 'peso_corporal', label: 'Peso corporal' },
  { id: 'bandas', label: 'Bandas' },
];

export const ProfileBiometricsView: React.FC = () => {
  const { workspace, updateProfile, saveBiometrics, savePreferences, completeOnboarding } = useWorkspace();

  const bio = workspace?.biometrics;
  const pref = workspace?.preferences;
  const profile = workspace?.profile;

  const [displayName, setDisplayName] = useState(profile?.displayName ?? '');
  const [location, setLocation] = useState(profile?.location ?? '');
  const [goal, setGoal] = useState<AthleteGoal>(profile?.goal ?? 'hipertrofia');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(pref?.weightUnit ?? 'kg');

  // Biometric canonical SI values
  const [weightKg, setWeightKg] = useState<number>(bio?.weightKg ?? 75);
  const [heightCm, setHeightCm] = useState<number>(bio?.heightCm ?? 176);
  const [age, setAge] = useState<number>(bio?.age ?? 28);
  const [bodyFatPct, setBodyFatPct] = useState<number>(bio?.bodyFatPct ?? 15);
  const [palFactor, setPalFactor] = useState<number>(bio?.palFactor ?? 1.55);
  const [targetDeltaKcal, setTargetDeltaKcal] = useState<number>(bio?.targetDeltaKcal ?? 200);
  const [proteinPerKg, setProteinPerKg] = useState<number>(bio?.proteinPerKg ?? 2.0);
  const [fatPerKg, setFatPerKg] = useState<number>(bio?.fatPerKg ?? 0.9);

  // Preferences
  const [trainingDays, setTrainingDays] = useState<number>(pref?.trainingDaysPerWeek ?? 4);
  const [experience, setExperience] = useState<TrainingExperience>(pref?.trainingExperience ?? 'intermedio');
  const [dietary, setDietary] = useState<DietaryPreference>(pref?.dietaryPreference ?? 'omnivoro');
  const [mealsPerDay, setMealsPerDay] = useState<number>(pref?.mealsPerDay ?? 4);
  const [equipment, setEquipment] = useState<EquipmentRequired[]>(
    pref?.availableEquipment ?? ['barra', 'mancuerna', 'polea', 'maquina']
  );

  // Guided Onboarding Wizard Mode
  const [wizardOpen, setWizardOpen] = useState<boolean>(false);
  const [wizardStep, setWizardStep] = useState<number>(1);
  const [validationMsg, setValidationMsg] = useState<string | null>(null);
  const [securityTestResult, setSecurityTestResult] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setDisplayName(profile.displayName);
    setLocation(profile.location ?? '');
    setGoal(profile.goal ?? 'hipertrofia');
  }, [profile]);

  useEffect(() => {
    if (!bio) return;
    setWeightKg(bio.weightKg ?? 75);
    setHeightCm(bio.heightCm ?? 176);
    setAge(bio.age ?? 28);
    setBodyFatPct(bio.bodyFatPct ?? 15);
    setPalFactor(bio.palFactor ?? 1.55);
    setTargetDeltaKcal(bio.targetDeltaKcal ?? 200);
    setProteinPerKg(bio.proteinPerKg ?? 2.0);
    setFatPerKg(bio.fatPerKg ?? 0.9);
  }, [bio]);

  useEffect(() => {
    if (!pref) return;
    setWeightUnit(pref.weightUnit ?? 'kg');
    setTrainingDays(pref.trainingDaysPerWeek ?? 4);
    setExperience(pref.trainingExperience ?? 'intermedio');
    setDietary(pref.dietaryPreference ?? 'omnivoro');
    setMealsPerDay(pref.mealsPerDay ?? 4);
    setEquipment(Array.isArray(pref.availableEquipment) ? pref.availableEquipment : ['barra', 'mancuerna', 'polea', 'maquina']);
  }, [pref]);

  const previewTargets = useMemo(() => {
    const safeWeight = Number.isFinite(weightKg) ? weightKg : 75;
    const safeHeight = Number.isFinite(heightCm) ? heightCm : 175;
    const safeAge = Number.isFinite(age) ? age : 28;
    return computeBiometricTargets({
      weightKg: Math.max(20, Math.min(350, safeWeight)),
      heightCm: Math.max(90, Math.min(260, safeHeight)),
      age: Math.max(12, Math.min(120, safeAge)),
      bodyFatPct: Math.max(2, Math.min(70, bodyFatPct)),
      palFactor: Math.max(1.0, Math.min(2.5, palFactor)),
      targetDeltaKcal,
      proteinPerKg,
      fatPerKg,
    });
  }, [weightKg, heightCm, age, bodyFatPct, palFactor, targetDeltaKcal, proteinPerKg, fatPerKg]);

  if (!workspace || !profile) return null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationMsg(null);
    try {
      await updateProfile({ displayName, location, goal });
    } catch (err) {
      setValidationMsg(err instanceof Error ? err.message : 'Error validando perfil');
    }
  };

  const handleSaveBiometrics = async (e: React.FormEvent) => {
    e.preventDefault();
    setValidationMsg(null);
    try {
      const payload = computeBiometricTargets({
        weightKg,
        heightCm,
        age,
        bodyFatPct,
        palFactor,
        targetDeltaKcal,
        proteinPerKg,
        fatPerKg,
      });
      await saveBiometrics(payload);
    } catch (err) {
      setValidationMsg(err instanceof Error ? err.message : 'Datos biométricos inválidos');
    }
  };

  const handleSavePreferences = async () => {
    await savePreferences({
      weightUnit,
      heightUnit: weightUnit === 'lbs' ? 'in' : 'cm',
      timezone: pref?.timezone ?? 'America/Bogota',
      trainingDaysPerWeek: trainingDays,
      sessionDurationMinutes: pref?.sessionDurationMinutes ?? 60,
      trainingExperience: experience,
      availableEquipment: equipment,
      trainingGoal: goal,
      muscleFocus: pref?.muscleFocus ?? ['pecho', 'espalda', 'cuadriceps'],
      mealsPerDay,
      dietaryPreference: dietary,
      onboardingStep: 6,
      onboardingCompleted: true,
      notificationPreferences: pref?.notificationPreferences ?? {
        mealReminders: true,
        workoutAlerts: true,
        groceryAlerts: true,
        systemUpdates: true,
      },
    });
  };

  const handleApplyGoalPreset = (selectedGoal: AthleteGoal) => {
    setGoal(selectedGoal);
    const preset = GOAL_OPTIONS.find(g => g.value === selectedGoal);
    if (preset) {
      setTargetDeltaKcal(preset.delta);
      setProteinPerKg(preset.prot);
      setFatPerKg(preset.fat);
    }
  };

  const handleCompleteWizard = async () => {
    setValidationMsg(null);
    try {
      await completeOnboarding({
        displayName,
        goal,
        biometrics: previewTargets,
        preferences: {
          weightUnit,
          heightUnit: weightUnit === 'lbs' ? 'in' : 'cm',
          timezone: pref?.timezone ?? 'America/Bogota',
          trainingDaysPerWeek: trainingDays,
          sessionDurationMinutes: 60,
          trainingExperience: experience,
          availableEquipment: equipment,
          trainingGoal: goal,
          muscleFocus: ['pecho', 'espalda', 'cuadriceps'],
          mealsPerDay,
          dietaryPreference: dietary,
          onboardingStep: 6,
          onboardingCompleted: true,
          notificationPreferences: pref?.notificationPreferences ?? {
            mealReminders: true,
            workoutAlerts: true,
            groceryAlerts: true,
            systemUpdates: true,
          },
        },
      });
      setWizardOpen(false);
      setWizardStep(1);
    } catch (err) {
      setValidationMsg(err instanceof Error ? err.message : 'Error en onboarding');
    }
  };

  const testImmutableSecurityGuard = async () => {
    try {
      await updateProfile({ displayName, role: 'superadmin' });
    } catch (err) {
      setSecurityTestResult(err instanceof Error ? err.message : 'Rechazado por contrato');
    }
  };

  const toggleEquip = (id: EquipmentRequired) => {
    setEquipment(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-ink">Perfil Biométrico y Configuración</h2>
          <p className="text-sm text-ink-muted">
            Las unidades canónicas se validan en sistema métrico (kg / cm) según el contrato futuro de Catalyst NoSQL; en desarrollo local operan solo en memoria.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeightUnit(u => (u === 'kg' ? 'lbs' : 'kg'))}
            className="px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-medium text-ink hover:bg-surface-alt cursor-pointer"
          >
            Unidades: {weightUnit === 'kg' ? 'Métrico (kg / cm)' : 'Imperial (lbs / in)'}
          </button>
          <button
            type="button"
            onClick={() => {
              setWizardStep(1);
              setWizardOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-medium cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Asistente de Onboarding</span>
          </button>
        </div>
      </div>

      {validationMsg && (
        <InlineAlert tone="error" title="Validación de dominio">
          {validationMsg}
        </InlineAlert>
      )}

      {/* Live Calculation Telemetry */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="TMB (Mifflin-St Jeor)" value={`${previewTargets.bmr} kcal`} detail="Gasto basal estimado" />
        <StatTile label="TDEE Mantenimiento" value={`${previewTargets.tdee} kcal`} detail={`PAL ${palFactor}`} />
        <StatTile label="Meta Calórica" value={`${previewTargets.targetCalories} kcal`} detail={`Delta ${targetDeltaKcal >= 0 ? `+${targetDeltaKcal}` : targetDeltaKcal} kcal`} tone="brand" />
        <StatTile
          label="Macros Objetivo"
          value={`${previewTargets.targetProteinG}P / ${previewTargets.targetCarbsG}C / ${previewTargets.targetFatG}G`}
          detail={`${formatWeight(weightKg, weightUnit)} · ${formatHeight(heightCm, weightUnit === 'lbs' ? 'in' : 'cm')}`}
          tone="info"
        />
      </div>

      {/* Onboarding Guided Stepper */}
      {wizardOpen && (
        <SectionCard
          title={`Asistente Guiado de Onboarding — Paso ${wizardStep} de 3`}
          subtitle="Configura identidad, biometría y preferencias en una sola operación atómica"
          action={
            <button
              type="button"
              onClick={() => setWizardOpen(false)}
              className="text-xs text-ink-muted hover:text-ink cursor-pointer"
            >
              Cerrar asistente
            </button>
          }
        >
          {wizardStep === 1 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Nombre visible</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-ink"
                />
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Objetivo principal</span>
                <select
                  value={goal}
                  onChange={e => handleApplyGoalPreset(e.target.value as AthleteGoal)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm text-ink"
                >
                  {GOAL_OPTIONS.map(g => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {wizardStep === 2 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Peso ({weightUnit})</span>
                <input
                  type="number"
                  step="0.5"
                  value={weightUnit === 'lbs' ? kgToLbs(weightKg) : weightKg}
                  onChange={e => {
                    const num = Number(e.target.value);
                    setWeightKg(weightUnit === 'lbs' ? lbsToKg(num) : num);
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Estatura ({weightUnit === 'lbs' ? 'in' : 'cm'})</span>
                <input
                  type="number"
                  step="1"
                  value={weightUnit === 'lbs' ? cmToIn(heightCm) : heightCm}
                  onChange={e => {
                    const num = Number(e.target.value);
                    setHeightCm(weightUnit === 'lbs' ? inToCm(num) : num);
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Edad</span>
                <input
                  type="number"
                  value={age}
                  onChange={e => setAge(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Grasa corporal (%)</span>
                <input
                  type="number"
                  step="0.5"
                  value={bodyFatPct}
                  onChange={e => setBodyFatPct(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>
            </div>
          )}

          {wizardStep === 3 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Días de entreno / sem</span>
                <select
                  value={trainingDays}
                  onChange={e => setTrainingDays(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm"
                >
                  {[2, 3, 4, 5, 6].map(d => (
                    <option key={d} value={d}>{d} días / semana</option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Experiencia</span>
                <select
                  value={experience}
                  onChange={e => setExperience(e.target.value as TrainingExperience)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm"
                >
                  <option value="principiante">Principiante</option>
                  <option value="intermedio">Intermedio</option>
                  <option value="avanzado">Avanzado</option>
                </select>
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Preferencia dietética</span>
                <select
                  value={dietary}
                  onChange={e => setDietary(e.target.value as DietaryPreference)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm"
                >
                  <option value="omnivoro">Omnívoro</option>
                  <option value="vegetariano">Vegetariano</option>
                  <option value="vegano">Vegano</option>
                  <option value="pescetariano">Pescetariano</option>
                  <option value="sin_gluten">Sin gluten</option>
                </select>
              </label>
            </div>
          )}

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <button
              type="button"
              disabled={wizardStep === 1}
              onClick={() => setWizardStep(s => Math.max(1, s - 1))}
              className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-ink disabled:opacity-40 cursor-pointer"
            >
              Anterior
            </button>
            {wizardStep < 3 ? (
              <button
                type="button"
                onClick={() => setWizardStep(s => s + 1)}
                className="px-4 py-1.5 rounded-lg bg-brand text-white text-xs font-medium cursor-pointer"
              >
                Siguiente
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleCompleteWizard()}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-brand text-white text-xs font-medium cursor-pointer"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Finalizar Onboarding</span>
              </button>
            )}
          </div>
        </SectionCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Profile Form */}
        <SectionCard
          title="Cuenta y Perfil Público"
          subtitle={`UID: ${profile.uid} · Segmento: ${profile.directorySegment} · Rol actual: ${profile.role}`}
        >
          <form onSubmit={e => void handleSaveProfile(e)} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Nombre completo</span>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm"
                  required
                />
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Ubicación / Ciudad</span>
                <input
                  type="text"
                  value={location}
                  onChange={e => setLocation(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm"
                />
              </label>
            </div>
            <label className="block text-xs font-medium text-ink space-y-1">
              <span>Objetivo Nutricional / Deportivo</span>
              <select
                value={goal}
                onChange={e => handleApplyGoalPreset(e.target.value as AthleteGoal)}
                className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm"
              >
                {GOAL_OPTIONS.map(g => (
                  <option key={g.value} value={g.value}>{g.label}</option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium cursor-pointer"
              >
                Guardar perfil
              </button>
              <button
                type="button"
                onClick={() => void testImmutableSecurityGuard()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs text-ink-muted hover:text-ink cursor-pointer"
              >
                <ShieldAlert className="w-3.5 h-3.5" />
                <span>Probar bloqueo de rol en cliente</span>
              </button>
            </div>
            {securityTestResult && (
              <InlineAlert tone="success" title="Inmutabilidad de campos de seguridad verificada">
                {securityTestResult}
              </InlineAlert>
            )}
          </form>
        </SectionCard>

        {/* Biometrics Form */}
        <SectionCard
          title="Parámetros Biométricos y Macros"
          subtitle="Rangos estrictos: peso [20..350] kg, estatura [90..260] cm, PAL [1.0..2.5]"
        >
          <form onSubmit={e => void handleSaveBiometrics(e)} className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Peso (kg)</span>
                <input
                  type="number"
                  step="0.1"
                  value={weightKg}
                  onChange={e => setWeightKg(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Estatura (cm)</span>
                <input
                  type="number"
                  step="1"
                  value={heightCm}
                  onChange={e => setHeightCm(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Edad</span>
                <input
                  type="number"
                  value={age}
                  onChange={e => setAge(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>% Grasa</span>
                <input
                  type="number"
                  step="0.1"
                  value={bodyFatPct}
                  onChange={e => setBodyFatPct(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Factor PAL</span>
                <input
                  type="number"
                  step="0.05"
                  value={palFactor}
                  onChange={e => setPalFactor(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Delta kcal</span>
                <input
                  type="number"
                  step="50"
                  value={targetDeltaKcal}
                  onChange={e => setTargetDeltaKcal(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Proteína (g/kg)</span>
                <input
                  type="number"
                  step="0.1"
                  value={proteinPerKg}
                  onChange={e => setProteinPerKg(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>
              <label className="text-xs font-medium text-ink space-y-1">
                <span>Grasa (g/kg)</span>
                <input
                  type="number"
                  step="0.05"
                  value={fatPerKg}
                  onChange={e => setFatPerKg(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm tabular-nums"
                />
              </label>
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium cursor-pointer"
            >
              Guardar biometría y metas
            </button>
          </form>
        </SectionCard>
      </div>

      {/* Preferences */}
      <SectionCard
        title="Preferencias de Entrenamiento y Alimentación"
        subtitle="Acopladas al generador de mesociclos y sincronizadas vía PUT /api/v1/athlete/preferences"
        action={
          <button
            type="button"
            onClick={() => void handleSavePreferences()}
            className="px-4 py-1.5 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-medium cursor-pointer"
          >
            Guardar preferencias
          </button>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="text-xs font-medium text-ink space-y-1">
            <span>Días de entrenamiento / semana</span>
            <select
              value={trainingDays}
              onChange={e => setTrainingDays(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm"
            >
              {[2, 3, 4, 5, 6].map(d => (
                <option key={d} value={d}>{d} días</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-ink space-y-1">
            <span>Comidas al día</span>
            <select
              value={mealsPerDay}
              onChange={e => setMealsPerDay(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm"
            >
              {[3, 4, 5].map(m => (
                <option key={m} value={m}>{m} tomas</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-ink space-y-1">
            <span>Patrón dietético</span>
            <select
              value={dietary}
              onChange={e => setDietary(e.target.value as DietaryPreference)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-sm"
            >
              <option value="omnivoro">Omnívoro</option>
              <option value="vegetariano">Vegetariano</option>
              <option value="vegano">Vegano</option>
              <option value="pescetariano">Pescetariano</option>
              <option value="sin_gluten">Sin gluten</option>
            </select>
          </label>
        </div>
        <div>
          <div className="text-xs font-medium text-ink mb-2">Equipamiento disponible</div>
          <div className="flex flex-wrap gap-2">
            {EQUIPMENT_LIST.map(eq => {
              const active = equipment.includes(eq.id);
              return (
                <button
                  key={eq.id}
                  type="button"
                  onClick={() => toggleEquip(eq.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer transition-colors ${
                    active
                      ? 'bg-brand text-white border-brand'
                      : 'bg-canvas text-ink-muted border-border hover:text-ink'
                  }`}
                >
                  {eq.label}
                </button>
              );
            })}
          </div>
        </div>
      </SectionCard>
    </div>
  );
};
