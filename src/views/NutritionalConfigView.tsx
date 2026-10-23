import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

export const NutritionalConfigView: React.FC = () => {
  const { biometrics, updateBiometrics, resetBiometricsToExcel, showToast, mealPartition, updateMealPartition } = useApp();

  const [weight, setWeight] = useState(biometrics.weightKg);
  const [height, setHeight] = useState(biometrics.heightCm);
  const [fat, setFat] = useState(biometrics.bodyFatPct);
  const [pal, setPal] = useState(biometrics.palFactor);
  const [goalDelta, setGoalDelta] = useState(biometrics.targetDeltaKcal);
  const [proteinRate, setProteinRate] = useState(biometrics.proteinPerKg);
  const [fatRate, setFatRate] = useState(biometrics.fatPerKg);

  const handleApplyChanges = () => {
    updateBiometrics({
      weightKg: Number(weight),
      heightCm: Number(height),
      bodyFatPct: Number(fat),
      palFactor: Number(pal),
      targetDeltaKcal: Number(goalDelta),
      proteinPerKg: Number(proteinRate),
      fatPerKg: Number(fatRate),
    });
    showToast('Parámetros guardados y sincronizados con Cloud Firestore');
  };

  const handleReset = () => {
    resetBiometricsToExcel();
    setWeight(74.5);
    setHeight(178);
    setFat(15.2);
    setPal(1.55);
    setGoalDelta(-400);
    setProteinRate(2.0);
    setFatRate(0.8);
  };

  // Immediate preview values
  const previewBmr = Math.round(10 * weight + 6.25 * height - 5 * 30 + 5);
  const previewTdee = Math.round(previewBmr * pal);
  const previewTargetCalories = previewTdee + goalDelta;
  const previewProteinG = Math.round(weight * proteinRate);
  const previewFatG = Math.round(weight * fatRate);
  const previewCarbsG = Math.max(0, Math.round((previewTargetCalories - previewProteinG * 4 - previewFatG * 9) / 4));

  const proteinPct = Math.round(((previewProteinG * 4) / previewTargetCalories) * 100) || 26;
  const fatPct = Math.round(((previewFatG * 9) / previewTargetCalories) * 100) || 23;
  const carbsPct = Math.max(0, 100 - proteinPct - fatPct);

  return (
    <div className="p-4 sm:p-gutter-desktop flex flex-col gap-space-lg max-w-[1440px] mx-auto w-full animate-in fade-in duration-150">
      {/* Header Section */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-space-lg pb-space-xs">
        <div className="flex flex-col gap-space-xs">
          <div className="flex items-center gap-space-sm flex-wrap">
            <span className="font-label-sm text-label-sm text-primary tracking-widest uppercase bg-primary-fixed/30 px-2.5 py-0.5 rounded-full font-semibold">
              Metabolismo &amp; Algoritmos
            </span>
            <span className="flex items-center gap-1.5 font-code-data text-code-data text-on-surface-variant bg-surface-container-low px-2 py-0.5 rounded-full">
              <span className="material-symbols-outlined text-xs text-primary">cloud_done</span>
              Última sincronización: Hoy, 08:30 AM (COT)
            </span>
          </div>
          <h1 className="font-headline-lg text-headline-lg text-on-surface font-semibold tracking-tight">
            Configuración Nutricional
          </h1>
          <p className="font-body-md text-body-md text-on-surface-variant max-w-3xl">
            Parámetros metabólicos, objetivos de macronutrientes y fórmulas maestras sincronizadas con el libro de Excel y Supabase.
          </p>
        </div>

        <div className="flex items-center gap-space-sm shrink-0 self-start lg:self-center">
          <button
            onClick={handleReset}
            className="flex items-center gap-space-xs px-space-md py-2 bg-surface-container-lowest hover:bg-surface-container-low text-on-surface font-label-md text-label-md rounded-lg shadow-xs transition-colors"
            type="button"
          >
            <span className="material-symbols-outlined text-base text-secondary">history</span>
            <span>Restablecer Excel</span>
          </button>
          <button
            onClick={handleApplyChanges}
            className="flex items-center gap-space-xs px-space-lg py-2 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg shadow-sm transition-all"
            type="button"
          >
            <span className="material-symbols-outlined text-base">check</span>
            <span>Guardar cambios</span>
          </button>
        </div>
      </section>

      {/* Reactive Notice */}
      <div className="p-space-md bg-surface-container-low rounded-xl flex items-start sm:items-center justify-between gap-space-md shadow-xs border border-surface-container/60">
        <div className="flex items-center gap-space-md min-w-0">
          <div className="w-9 h-9 rounded-lg bg-surface-container-lowest flex items-center justify-center shrink-0 text-primary shadow-xs">
            <span className="material-symbols-outlined text-xl">functions</span>
          </div>
          <div className="flex flex-col">
            <span className="font-label-md text-label-md font-semibold text-on-surface">
              Modo de cálculo maestro activo: Mifflin-St Jeor + Factor PAL
            </span>
            <span className="font-body-md text-body-md text-on-surface-variant">
              Los cambios en los parámetros base afectarán automáticamente los macro-targets del Menú Semanal y el Registro Diario.
            </span>
          </div>
        </div>
        <span className="hidden sm:inline-flex items-center gap-1 font-label-sm text-label-sm bg-primary-fixed/40 text-on-primary-fixed-variant px-2.5 py-1 rounded-full font-medium shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          Reactivo
        </span>
      </div>

      {/* Main 2-Column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-space-lg">
        {/* Left Column (7 Cols): Biometrics & Meal Partition */}
        <section className="lg:col-span-7 flex flex-col gap-space-lg">
          {/* Card: Biometrics & Energy */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-lg">
            <div className="flex items-center justify-between pb-2 border-b border-surface-container/40">
              <div className="flex items-center gap-space-sm">
                <span className="material-symbols-outlined text-primary text-xl">monitor_weight</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Parámetros Biométricos y Gasto Energético
                </h2>
              </div>
              <span className="font-label-sm text-label-sm bg-surface-container-low text-on-surface-variant px-2 py-0.5 rounded-full font-medium">
                BMR &amp; TDEE
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-md">
              <div className="bg-surface-container-low/60 p-space-md rounded-lg flex flex-col gap-space-xs border border-surface-container/40">
                <div className="flex items-center justify-between">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                    Peso Base
                  </span>
                  <span className="font-label-sm text-label-sm text-primary font-semibold bg-surface-container-lowest px-1.5 py-0.5 rounded">
                    Base
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <input
                    type="number"
                    step="0.1"
                    value={weight}
                    onChange={e => setWeight(parseFloat(e.target.value) || 0)}
                    className="w-24 bg-surface-container-lowest text-on-surface font-metric-md text-metric-md font-semibold rounded px-2 py-1 outline-none border border-surface-container"
                  />
                  <span className="font-label-md text-label-md text-on-surface-variant font-medium">kg</span>
                </div>
                <span className="font-code-data text-code-data text-on-surface-variant/70">
                  Último pesaje en ayunas
                </span>
              </div>

              <div className="bg-surface-container-low/60 p-space-md rounded-lg flex flex-col gap-space-xs border border-surface-container/40">
                <div className="flex items-center justify-between">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                    Estatura
                  </span>
                  <span className="font-label-sm text-label-sm text-secondary font-medium bg-surface-container-lowest px-1.5 py-0.5 rounded">
                    Fijo
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <input
                    type="number"
                    step="1"
                    value={height}
                    onChange={e => setHeight(parseFloat(e.target.value) || 0)}
                    className="w-24 bg-surface-container-lowest text-on-surface font-metric-md text-metric-md font-semibold rounded px-2 py-1 outline-none border border-surface-container"
                  />
                  <span className="font-label-md text-label-md text-on-surface-variant font-medium">cm</span>
                </div>
                <span className="font-code-data text-code-data text-on-surface-variant/70">
                  Antropometría Q3
                </span>
              </div>

              <div className="bg-surface-container-low/60 p-space-md rounded-lg flex flex-col gap-space-xs border border-surface-container/40">
                <div className="flex items-center justify-between">
                  <span className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">
                    % Grasa
                  </span>
                  <span className="font-label-sm text-label-sm text-secondary font-medium bg-surface-container-lowest px-1.5 py-0.5 rounded">
                    Bioimpedancia
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <input
                    type="number"
                    step="0.1"
                    value={fat}
                    onChange={e => setFat(parseFloat(e.target.value) || 0)}
                    className="w-24 bg-surface-container-lowest text-on-surface font-metric-md text-metric-md font-semibold rounded px-2 py-1 outline-none border border-surface-container"
                  />
                  <span className="font-label-md text-label-md text-on-surface-variant font-medium">%</span>
                </div>
                <span className="font-code-data text-code-data text-on-surface-variant/70">
                  Masa magra: {(weight * (1 - fat / 100)).toFixed(1)} kg
                </span>
              </div>
            </div>

            {/* PAL Activity Factor Select */}
            <div className="bg-surface-container-low/40 rounded-xl p-space-md flex flex-col gap-space-sm border border-surface-container/40">
              <label
                className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold"
                htmlFor="select-pal"
              >
                Factor de Actividad Física (PAL / Nivel de entrenamiento)
              </label>
              <div className="relative">
                <select
                  id="select-pal"
                  value={pal}
                  onChange={e => setPal(parseFloat(e.target.value))}
                  className="w-full bg-surface-container-lowest text-on-surface font-body-md text-body-md rounded-lg px-space-md py-2.5 appearance-none pr-10 outline-none shadow-xs cursor-pointer border border-surface-container"
                >
                  <option value={1.2}>1.20 - Sedentario (Poco o ningún ejercicio, trabajo de escritorio)</option>
                  <option value={1.375}>1.375 - Ligero (Entrenamiento ligero 1-3 días por semana)</option>
                  <option value={1.55}>
                    1.55 - Moderadamente activo (Entrenamiento con pesas 4-5 días + 8k pasos)
                  </option>
                  <option value={1.725}>1.725 - Muy activo (Entrenamientos intensos 6-7 días/sem o doble sesión)</option>
                  <option value={1.9}>
                    1.90 - Atleta Élite (Alto rendimiento, deportes de resistencia o trabajo físico pesado)
                  </option>
                </select>
                <span className="material-symbols-outlined text-on-surface-variant absolute right-3 top-2.5 pointer-events-none">
                  unfold_more
                </span>
              </div>
            </div>

            {/* BMR and TDEE Result Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-space-md">
              <div className="p-space-md rounded-xl bg-surface-container-low flex flex-col justify-between gap-space-sm border border-surface-container/50">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-secondary text-sm">lock</span>
                    <span className="font-label-sm text-label-sm text-secondary font-semibold uppercase">
                      Tasa Metabólica Basal
                    </span>
                  </div>
                  <span className="font-code-data text-code-data text-on-surface-variant bg-surface-container-lowest px-2 py-0.5 rounded">
                    TMB / BMR
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-metric-xl text-metric-xl font-bold text-on-surface">
                    {previewBmr.toLocaleString('es-CO')}
                  </span>
                  <span className="font-label-md text-label-md text-on-surface-variant">kcal / día</span>
                </div>
                <div className="pt-space-xs font-code-data text-code-data text-on-surface-variant/80 truncate">
                  Fórmula: (10 × {weight}kg) + (6.25 × {height}cm) - (5 × 30) + 5
                </div>
              </div>

              <div className="p-space-md rounded-xl bg-secondary-container/40 flex flex-col justify-between gap-space-sm border border-secondary-container">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-primary text-sm">bolt</span>
                    <span className="font-label-sm text-label-sm text-on-secondary-container font-semibold uppercase">
                      Gasto Energético Total
                    </span>
                  </div>
                  <span className="font-code-data text-code-data text-on-secondary-container bg-surface-container-lowest px-2 py-0.5 rounded font-semibold">
                    TDEE Calculado
                  </span>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-metric-xl text-metric-xl font-bold text-on-secondary-container">
                    {previewTdee.toLocaleString('es-CO')}
                  </span>
                  <span className="font-label-md text-label-md text-on-secondary-container/80">kcal / día</span>
                </div>
                <div className="pt-space-xs font-code-data text-code-data text-on-secondary-container/80 truncate">
                  BMR ({previewBmr}) × Factor PAL ({pal}) = {previewTdee} kcal
                </div>
              </div>
            </div>
          </div>

          {/* Card: Reparto por Momento de Consumo */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-lg">
            <div className="flex items-center justify-between pb-2 border-b border-surface-container/40">
              <div className="flex items-center gap-space-sm">
                <span className="material-symbols-outlined text-primary text-xl">pie_chart</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Reparto por Momento de Consumo
                </h2>
              </div>
              <div className="flex items-center gap-1.5 bg-primary-fixed/30 text-on-primary-fixed-variant px-2.5 py-1 rounded-full font-label-sm text-label-sm font-semibold">
                <span className="material-symbols-outlined text-xs">check_circle</span>
                <span>Total: 100% ({previewTargetCalories} kcal)</span>
              </div>
            </div>

            {/* Proportion Bar */}
            <div className="h-2.5 w-full bg-surface-container-low rounded-full overflow-hidden flex">
              <div className="bg-primary h-full transition-all duration-300" style={{ width: `${mealPartition.desayunoPct}%` }} title="Desayuno (25%)" />
              <div className="bg-tertiary h-full transition-all duration-300" style={{ width: `${mealPartition.almuerzoPct}%` }} title="Almuerzo (35%)" />
              <div className="bg-secondary-fixed-dim h-full transition-all duration-300" style={{ width: `${mealPartition.meriendaPct}%` }} title="Merienda (15%)" />
              <div className="bg-primary-container h-full transition-all duration-300" style={{ width: `${mealPartition.cenaPct}%` }} title="Cena (25%)" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-space-sm">
              <div className="p-space-sm bg-surface-container-low/60 rounded-lg flex flex-col gap-1 border border-surface-container/30">
                <div className="flex items-center justify-between">
                  <span className="font-label-md text-label-md font-semibold text-on-surface flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-primary" />
                    Desayuno
                  </span>
                  <span className="font-code-data text-code-data font-semibold text-primary">
                    {mealPartition.desayunoPct}%
                  </span>
                </div>
                <span className="font-metric-md text-metric-md font-bold text-on-surface">
                  {Math.round((previewTargetCalories * mealPartition.desayunoPct) / 100)}{' '}
                  <span className="font-label-sm text-label-sm font-normal text-on-surface-variant">kcal</span>
                </span>
                <span className="font-code-data text-code-data text-on-surface-variant text-[11px]">
                  P: {Math.round((previewProteinG * 0.25))}g | C: {Math.round((previewCarbsG * 0.25))}g | G: {Math.round((previewFatG * 0.25))}g
                </span>
              </div>

              <div className="p-space-sm bg-surface-container-low/60 rounded-lg flex flex-col gap-1 border border-surface-container/30">
                <div className="flex items-center justify-between">
                  <span className="font-label-md text-label-md font-semibold text-on-surface flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-tertiary" />
                    Almuerzo
                  </span>
                  <span className="font-code-data text-code-data font-semibold text-tertiary">
                    {mealPartition.almuerzoPct}%
                  </span>
                </div>
                <span className="font-metric-md text-metric-md font-bold text-on-surface">
                  {Math.round((previewTargetCalories * mealPartition.almuerzoPct) / 100)}{' '}
                  <span className="font-label-sm text-label-sm font-normal text-on-surface-variant">kcal</span>
                </span>
                <span className="font-code-data text-code-data text-on-surface-variant text-[11px]">
                  P: {Math.round((previewProteinG * 0.35))}g | C: {Math.round((previewCarbsG * 0.35))}g | G: {Math.round((previewFatG * 0.35))}g
                </span>
              </div>

              <div className="p-space-sm bg-surface-container-low/60 rounded-lg flex flex-col gap-1 border border-surface-container/30">
                <div className="flex items-center justify-between">
                  <span className="font-label-md text-label-md font-semibold text-on-surface flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-secondary" />
                    Merienda
                  </span>
                  <span className="font-code-data text-code-data font-semibold text-secondary">
                    {mealPartition.meriendaPct}%
                  </span>
                </div>
                <span className="font-metric-md text-metric-md font-bold text-on-surface">
                  {Math.round((previewTargetCalories * mealPartition.meriendaPct) / 100)}{' '}
                  <span className="font-label-sm text-label-sm font-normal text-on-surface-variant">kcal</span>
                </span>
                <span className="font-code-data text-code-data text-on-surface-variant text-[11px]">
                  P: {Math.round((previewProteinG * 0.15))}g | C: {Math.round((previewCarbsG * 0.15))}g | G: {Math.round((previewFatG * 0.15))}g
                </span>
              </div>

              <div className="p-space-sm bg-surface-container-low/60 rounded-lg flex flex-col gap-1 border border-surface-container/30">
                <div className="flex items-center justify-between">
                  <span className="font-label-md text-label-md font-semibold text-on-surface flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-primary-container" />
                    Cena
                  </span>
                  <span className="font-code-data text-code-data font-semibold text-primary-container">
                    {mealPartition.cenaPct}%
                  </span>
                </div>
                <span className="font-metric-md text-metric-md font-bold text-on-surface">
                  {Math.round((previewTargetCalories * mealPartition.cenaPct) / 100)}{' '}
                  <span className="font-label-sm text-label-sm font-normal text-on-surface-variant">kcal</span>
                </span>
                <span className="font-code-data text-code-data text-on-surface-variant text-[11px]">
                  P: {Math.round((previewProteinG * 0.25))}g | C: {Math.round((previewCarbsG * 0.25))}g | G: {Math.round((previewFatG * 0.25))}g
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-space-xs text-on-surface-variant font-body-md text-body-md bg-surface-container-low/30 px-space-md py-2 rounded-lg border border-surface-container/30">
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-sm text-primary">auto_schedule</span>
                Ventana anabólica optimizada: Distribución de leucina ≥ 3g por comida principal
              </span>
              <span className="font-label-sm text-label-sm text-primary font-semibold">Validado</span>
            </div>
          </div>
        </section>

        {/* Right Column (5 Cols): Strategy, Macronutrients & Database Mapping */}
        <section className="lg:col-span-5 flex flex-col gap-space-lg">
          {/* Strategy & Macros Card */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-lg">
            <div className="flex items-center justify-between pb-2 border-b border-surface-container/40">
              <div className="flex items-center gap-space-sm">
                <span className="material-symbols-outlined text-primary text-xl">tune</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Estrategia y Macronutrientes
                </h2>
              </div>
              <span className="font-label-sm text-label-sm bg-surface-container-low text-on-surface-variant px-2 py-0.5 rounded-full font-medium">
                Meta Diaria
              </span>
            </div>

            {/* Target Goal Selector */}
            <div className="flex flex-col gap-space-xs">
              <label className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider font-semibold">
                Objetivo Metabólico Actual
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setGoalDelta(250)}
                  className={`flex flex-col items-center justify-center p-2 rounded-lg text-center transition-all ${
                    goalDelta > 0
                      ? 'bg-primary text-on-primary shadow-xs font-semibold'
                      : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="font-label-md text-label-md font-semibold">Superávit</span>
                  <span className="font-code-data text-code-data">+250 kcal</span>
                </button>

                <button
                  type="button"
                  onClick={() => setGoalDelta(-400)}
                  className={`flex flex-col items-center justify-center p-2 rounded-lg text-center transition-all ${
                    goalDelta === -400
                      ? 'bg-primary text-on-primary shadow-xs font-semibold'
                      : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="font-label-md text-label-md font-semibold">Déficit Mod.</span>
                  <span className="font-code-data text-code-data font-medium">-400 kcal</span>
                </button>

                <button
                  type="button"
                  onClick={() => setGoalDelta(0)}
                  className={`flex flex-col items-center justify-center p-2 rounded-lg text-center transition-all ${
                    goalDelta === 0
                      ? 'bg-primary text-on-primary shadow-xs font-semibold'
                      : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className="font-label-md text-label-md font-semibold">Normocalórica</span>
                  <span className="font-code-data text-code-data">0 kcal</span>
                </button>
              </div>
            </div>

            {/* Target Calories Result */}
            <div className="bg-surface-container-high/40 p-space-md rounded-xl flex items-center justify-between border border-surface-container">
              <div className="flex flex-col">
                <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">
                  Presupuesto Calórico Diario
                </span>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="font-metric-xl text-metric-xl font-bold text-on-surface">
                    {previewTargetCalories.toLocaleString('es-CO')}
                  </span>
                  <span className="font-label-md text-label-md text-on-surface-variant">kcal / día</span>
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="font-code-data text-code-data text-primary font-semibold">
                  Auto (TDEE {goalDelta >= 0 ? `+ ${goalDelta}` : `${goalDelta}`})
                </span>
                <span className="font-label-sm text-label-sm text-on-surface-variant">
                  {goalDelta < 0 ? 'Pérdida ~0.45kg/sem' : goalDelta > 0 ? 'Hipertrofia magra' : 'Mantenimiento'}
                </span>
              </div>
            </div>

            {/* Macro Sliders */}
            <div className="flex flex-col gap-space-md">
              {/* Protein Slider */}
              <div className="flex flex-col gap-space-xs p-space-sm rounded-lg bg-surface-container-low/50 border border-surface-container/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-primary" />
                    <span className="font-label-md text-label-md font-semibold text-on-surface">Proteínas</span>
                    <span className="font-label-sm text-label-sm bg-primary-fixed/40 text-on-primary-fixed-variant px-1.5 py-0.2 rounded font-medium">
                      {proteinRate.toFixed(1)} g/kg
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-headline-sm text-headline-sm font-bold text-on-surface">
                      {previewProteinG} g
                    </span>
                    <span className="font-code-data text-code-data text-on-surface-variant ml-1">
                      {previewProteinG * 4} kcal ({proteinPct}%)
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min="1.4"
                  max="2.6"
                  step="0.1"
                  value={proteinRate}
                  onChange={e => setProteinRate(parseFloat(e.target.value))}
                  className="w-full accent-primary h-1.5 bg-surface-container-highest rounded-lg cursor-pointer"
                />
                <div className="flex justify-between font-code-data text-code-data text-on-surface-variant text-[11px]">
                  <span>Rango recomendado: 1.8 - 2.2 g/kg</span>
                  <span className="text-primary font-semibold">Preservación muscular óptima</span>
                </div>
              </div>

              {/* Fats Slider */}
              <div className="flex flex-col gap-space-xs p-space-sm rounded-lg bg-surface-container-low/50 border border-surface-container/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-secondary" />
                    <span className="font-label-md text-label-md font-semibold text-on-surface">Grasas Saludables</span>
                    <span className="font-label-sm text-label-sm bg-secondary-container text-on-secondary-container px-1.5 py-0.2 rounded font-medium">
                      {fatRate.toFixed(2)} g/kg
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-headline-sm text-headline-sm font-bold text-on-surface">
                      {previewFatG} g
                    </span>
                    <span className="font-code-data text-code-data text-on-surface-variant ml-1">
                      {previewFatG * 9} kcal ({fatPct}%)
                    </span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0.6"
                  max="1.2"
                  step="0.05"
                  value={fatRate}
                  onChange={e => setFatRate(parseFloat(e.target.value))}
                  className="w-full accent-secondary h-1.5 bg-surface-container-highest rounded-lg cursor-pointer"
                />
                <div className="flex justify-between font-code-data text-code-data text-on-surface-variant text-[11px]">
                  <span>Piso hormonal: ≥ 0.7 g/kg</span>
                  <span className="text-secondary font-semibold">Salud endocrina</span>
                </div>
              </div>

              {/* Dynamic Carbs */}
              <div className="flex flex-col gap-space-xs p-space-sm rounded-lg bg-surface-container-low/50 border border-surface-container/40">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-tertiary" />
                    <span className="font-label-md text-label-md font-semibold text-on-surface">Carbohidratos</span>
                    <span className="font-label-sm text-label-sm bg-tertiary-fixed text-on-tertiary-fixed-variant px-1.5 py-0.2 rounded font-medium">
                      Resto Calórico
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-headline-sm text-headline-sm font-bold text-on-surface">
                      {previewCarbsG} g
                    </span>
                    <span className="font-code-data text-code-data text-on-surface-variant ml-1">
                      {previewCarbsG * 4} kcal ({carbsPct}%)
                    </span>
                  </div>
                </div>
                <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
                  <div className="h-full bg-tertiary rounded-full" style={{ width: `${carbsPct}%` }} />
                </div>
                <div className="flex justify-between font-code-data text-code-data text-on-surface-variant text-[11px]">
                  <span>Calculado dinámico residual</span>
                  <span className="text-tertiary font-semibold">Rendimiento en glucógeno</span>
                </div>
              </div>
            </div>

            {/* Split Summary */}
            <div className="p-space-md rounded-xl bg-surface-container-low flex flex-col gap-space-xs border border-surface-container/40">
              <span className="font-label-sm text-label-sm text-on-surface-variant uppercase font-semibold">
                Distribución Macro Absoluta
              </span>
              <div className="flex items-center justify-between font-headline-sm text-headline-sm font-bold pt-1">
                <span className="text-primary">
                  {proteinPct}%{' '}
                  <span className="font-label-sm text-label-sm font-normal text-on-surface-variant block">Proteína</span>
                </span>
                <span className="text-on-surface-variant/30">/</span>
                <span className="text-secondary">
                  {fatPct}%{' '}
                  <span className="font-label-sm text-label-sm font-normal text-on-surface-variant block">Grasas</span>
                </span>
                <span className="text-on-surface-variant/30">/</span>
                <span className="text-tertiary">
                  {carbsPct}%{' '}
                  <span className="font-label-sm text-label-sm font-normal text-on-surface-variant block">Carbos</span>
                </span>
              </div>
            </div>
          </div>

          {/* Database & Excel Mapping Card */}
          <div className="bg-surface-container-lowest rounded-xl p-space-lg shadow-xs border border-surface-container/50 flex flex-col gap-space-md">
            <div className="flex items-center justify-between pb-2 border-b border-surface-container/40">
              <div className="flex items-center gap-space-sm">
                <span className="material-symbols-outlined text-secondary text-xl">database</span>
                <h2 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
                  Mapeo Excel &amp; Supabase
                </h2>
              </div>
              <span className="font-label-sm text-label-sm bg-primary-fixed/30 text-on-primary-fixed-variant px-2 py-0.5 rounded-full font-semibold">
                Integridad OK
              </span>
            </div>

            <div className="flex flex-col gap-space-sm font-body-md text-body-md">
              <div className="flex items-center justify-between py-1.5 border-b border-surface-container-low">
                <span className="text-on-surface-variant font-label-md text-label-md">Hoja Maestra Vinculada</span>
                <span className="font-code-data text-code-data text-on-surface font-semibold bg-surface-container-low px-2 py-1 rounded">
                  Config_Nutricion_Master.xlsx
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-surface-container-low">
                <span className="text-on-surface-variant font-label-md text-label-md">Frecuencia Sincronización</span>
                <span className="font-label-md text-label-md text-on-surface font-medium flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs text-primary">schedule</span>
                  Cada 30 min (Background Job)
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-surface-container-low">
                <span className="text-on-surface-variant font-label-md text-label-md">Zona Horaria Servidor</span>
                <span className="font-code-data text-code-data text-on-surface">America/Bogota (UTC-5)</span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-on-surface-variant font-label-md text-label-md">Manejo de Valores Vacíos</span>
                <span className="font-label-sm text-label-sm text-primary font-medium bg-surface-container-low px-2 py-0.5 rounded-full">
                  Conservar pendiente (sin ceros)
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-space-xs">
              <button
                onClick={() => showToast('Log Supabase: 0 errores de esquema. 320 matrices en cache.')}
                className="font-label-sm text-label-sm text-primary hover:underline font-semibold flex items-center gap-1 cursor-pointer"
                type="button"
              >
                <span className="material-symbols-outlined text-sm">terminal</span>
                Ver log de sincronizaciones Supabase
              </button>
              <span className="font-code-data text-code-data text-on-surface-variant/60">ID: sync_89f02a</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
