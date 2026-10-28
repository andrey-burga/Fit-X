import React, { useState, useMemo } from 'react';
import { WorkoutRoutine } from '../../types/workout';
import {
  generateDeloadProposal,
  DeloadProposal,
  DeloadOptions,
} from '../../services/workoutAutoregulationService';

interface DeloadAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeRoutine: WorkoutRoutine | null;
  onApplyDeload: (proposal: DeloadProposal) => Promise<void>;
  onShowToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export const DeloadAssistantModal: React.FC<DeloadAssistantModalProps> = ({
  isOpen,
  onClose,
  activeRoutine,
  onApplyDeload,
  onShowToast,
}) => {
  if (!isOpen || !activeRoutine) return null;

  const [volumeReductionPct, setVolumeReductionPct] = useState<number>(50);
  const [rirIncrease, setRirIncrease] = useState<number>(2);
  const [reduceLoadPct, setReduceLoadPct] = useState<number>(0);
  const [isCreating, setIsCreating] = useState<boolean>(false);

  // Compute proposal reactively based on user selected toggles
  const proposal: DeloadProposal = useMemo(() => {
    return generateDeloadProposal(activeRoutine, {
      volumeReductionPct,
      rirIncrease,
      reduceLoadPct,
    });
  }, [activeRoutine, volumeReductionPct, rirIncrease, reduceLoadPct]);

  const handleConfirm = async () => {
    setIsCreating(true);
    try {
      await onApplyDeload(proposal);
      onShowToast(
        `¡Rutina de descarga "${proposal.deloadRoutineName}" creada y activada! Tu rutina original permanece intacta.`,
        'success'
      );
      onClose();
    } catch {
      onShowToast('Error al crear la rutina de descarga', 'warning');
    } finally {
      setIsCreating(false);
    }
  };

  const { comparisonSummary, rationale } = proposal;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-surface-container-lowest w-full max-w-3xl rounded-2xl shadow-xl border border-surface-container/70 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-space-lg border-b border-surface-container/40 flex items-start justify-between gap-space-sm bg-surface-container-low/50">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-secondary-fixed text-on-secondary-fixed font-label-sm text-xs font-bold uppercase tracking-wider">
                <span className="material-symbols-outlined text-xs">bedtime</span>
                Asistente de Descarga (Deload)
              </span>
              <span className="px-2 py-0.5 rounded bg-surface-container font-code-data text-xs text-on-surface-variant">
                Rutina: {activeRoutine.name}
              </span>
            </div>
            <h2 className="font-headline-md text-headline-md font-bold text-on-surface tracking-tight mt-1">
              Semana de Descarga y Resensibilización Neural
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant text-xs">
              Configura y previsualiza un microciclo de descarga activa. La rutina original se conserva sin alteraciones en tu biblioteca.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="p-space-lg overflow-y-auto flex flex-col gap-space-md text-sm">
          {/* Scientific Rationale Banner */}
          <div className="p-space-md rounded-xl bg-surface-container-low border border-surface-container/50 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 font-label-md text-on-surface font-bold text-xs uppercase tracking-wider">
              <span className="material-symbols-outlined text-primary text-base">info</span>
              Fundamento de la Descarga Activa
            </div>
            <p className="font-body-md text-on-surface text-xs leading-relaxed">
              {rationale}
            </p>
          </div>

          {/* Interactive Parameters Controls */}
          <div className="p-space-md rounded-xl bg-surface-container-low/70 border border-surface-container/60 flex flex-col gap-space-sm">
            <span className="font-label-md text-xs font-bold uppercase tracking-wider text-on-surface">
              Ajustes de la Semana de Descarga
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-sm">
              {/* Volume reduction selector */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-on-surface-variant font-medium">Reducción de Volumen:</label>
                <select
                  value={volumeReductionPct}
                  onChange={e => setVolumeReductionPct(parseInt(e.target.value, 10))}
                  className="bg-surface-container-lowest text-on-surface p-2 rounded-lg border border-surface-container font-code-data text-xs font-bold"
                >
                  <option value={40}>-40% de series efectivas</option>
                  <option value={50}>-50% de series (Recomendado)</option>
                  <option value={60}>-60% de series (Descarga profunda)</option>
                </select>
              </div>

              {/* RIR increment selector */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-on-surface-variant font-medium">Margen de Esfuerzo (RIR):</label>
                <select
                  value={rirIncrease}
                  onChange={e => setRirIncrease(parseInt(e.target.value, 10))}
                  className="bg-surface-container-lowest text-on-surface p-2 rounded-lg border border-surface-container font-code-data text-xs font-bold"
                >
                  <option value={1}>+1 RIR (Moderado)</option>
                  <option value={2}>+2 RIR (Recomendado, RIR 3-4)</option>
                  <option value={3}>+3 RIR (Técnica muy suave)</option>
                </select>
              </div>

              {/* Load reduction toggle */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-on-surface-variant font-medium">Ajuste de Carga:</label>
                <select
                  value={reduceLoadPct}
                  onChange={e => setReduceLoadPct(parseInt(e.target.value, 10))}
                  className="bg-surface-container-lowest text-on-surface p-2 rounded-lg border border-surface-container font-code-data text-xs font-bold"
                >
                  <option value={0}>Mantener Carga (Solo reducir series)</option>
                  <option value={10}>Reducir Carga un 10% (Alivio articular)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Side-by-Side Comparison KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-space-sm">
            <div className="p-space-sm rounded-xl bg-surface-container-low border border-surface-container/50 flex flex-col justify-between">
              <span className="text-xs text-on-surface-variant font-semibold uppercase">Series Efectivas</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-metric-md text-metric-md font-bold text-on-surface line-through text-on-surface-variant/60">
                  {comparisonSummary.originalTotalSets}
                </span>
                <span className="material-symbols-outlined text-sm text-primary">arrow_forward</span>
                <span className="font-metric-md text-metric-md font-bold text-primary">
                  {comparisonSummary.deloadTotalSets}
                </span>
              </div>
              <span className="text-[11px] text-primary font-semibold mt-1">
                -{comparisonSummary.setsReductionPct}% ({comparisonSummary.setsSaved} series menos)
              </span>
            </div>

            <div className="p-space-sm rounded-xl bg-surface-container-low border border-surface-container/50 flex flex-col justify-between">
              <span className="text-xs text-on-surface-variant font-semibold uppercase">RIR Objetivo Promedio</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="font-metric-md text-metric-md font-bold text-on-surface-variant/60">
                  RIR {comparisonSummary.originalAverageTargetRir}
                </span>
                <span className="material-symbols-outlined text-sm text-primary">arrow_forward</span>
                <span className="font-metric-md text-metric-md font-bold text-primary">
                  RIR {comparisonSummary.deloadAverageTargetRir}
                </span>
              </div>
              <span className="text-[11px] text-on-surface-variant mt-1">
                Lejos del fallo muscular (resensibilización)
              </span>
            </div>

            <div className="p-space-sm rounded-xl bg-surface-container-low border border-surface-container/50 flex flex-col justify-between">
              <span className="text-xs text-on-surface-variant font-semibold uppercase">Tiempo Estimado Ahorrado</span>
              <div className="flex items-baseline gap-1 mt-1">
                <span className="font-metric-md text-metric-md font-bold text-on-surface">
                  ~{comparisonSummary.estimatedTimeSavedMinutes}
                </span>
                <span className="text-xs text-on-surface-variant">minutos en la semana</span>
              </div>
              <span className="text-[11px] text-on-surface-variant mt-1">
                Sesiones más ágiles y menos fatigosas
              </span>
            </div>
          </div>

          {/* Day-by-Day Preview Accordion */}
          <div className="flex flex-col gap-2">
            <span className="font-label-md text-xs font-bold uppercase tracking-wider text-on-surface">
              Previsualización de Días y Ejercicios Modificados
            </span>
            <div className="flex flex-col gap-2">
              {proposal.days.map((day, idx) => (
                <div key={day.id} className="p-3 rounded-xl bg-surface-container-low/40 border border-surface-container/40 flex flex-col gap-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-on-surface">
                      Día {idx + 1}: {day.shortName || day.name}
                    </span>
                    <span className="font-code-data text-primary font-semibold">
                      {day.exercises.reduce((acc, ex) => acc + ex.sets, 0)} series
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1 border-t border-surface-container/20">
                    {day.exercises.map(ex => (
                      <div key={ex.id} className="flex justify-between items-center text-on-surface-variant bg-surface-container-lowest/60 px-2 py-1 rounded">
                        <span className="truncate max-w-[180px] font-medium text-on-surface">
                          {ex.exerciseId.replace('barbell_', '').replace('_', ' ')}
                        </span>
                        <span className="font-code-data font-bold text-primary">
                          {ex.sets} series × {ex.repsMin}-{ex.repsMax} @ RIR {ex.targetRir}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-space-md border-t border-surface-container/40 flex items-center justify-between gap-space-sm bg-surface-container-low/30">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-on-surface-variant hover:bg-surface-container hover:text-on-surface font-label-md text-xs font-semibold transition-colors cursor-pointer"
          >
            Cancelar (Sin Cambios)
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isCreating}
            className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-xs font-bold shadow-xs transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-sm">check_circle</span>
            <span>{isCreating ? 'Creando Descarga...' : 'Crear Rutina de Descarga y Activar'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
