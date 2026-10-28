import React, { useState, useEffect } from 'react';
import { ExerciseRecommendation } from '../../services/workoutAutoregulationService';

interface AutoregulationSuggestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  recommendation: ExerciseRecommendation | null;
  routineId: string;
  dayId: string;
  onApply: (updates: {
    targetWeightKg?: number;
    repsMin?: number;
    repsMax?: number;
    targetRir?: number;
  }) => Promise<void>;
  onShowToast: (msg: string, type?: 'success' | 'info' | 'warning') => void;
}

export const AutoregulationSuggestionModal: React.FC<AutoregulationSuggestionModalProps> = ({
  isOpen,
  onClose,
  recommendation,
  onApply,
  onShowToast,
}) => {
  if (!isOpen || !recommendation) return null;

  // Editable parameters for user override
  const [editedWeight, setEditedWeight] = useState<number>(recommendation.suggestedWeightKg);
  const [editedRepsMin, setEditedRepsMin] = useState<number>(recommendation.suggestedRepsMin);
  const [editedRepsMax, setEditedRepsMax] = useState<number>(recommendation.suggestedRepsMax);
  const [editedRir, setEditedRir] = useState<number>(recommendation.currentPrescription.targetRir ?? 2);
  const [isApplying, setIsApplying] = useState<boolean>(false);

  useEffect(() => {
    if (recommendation) {
      setEditedWeight(recommendation.suggestedWeightKg);
      setEditedRepsMin(recommendation.suggestedRepsMin);
      setEditedRepsMax(recommendation.suggestedRepsMax);
      setEditedRir(recommendation.currentPrescription.targetRir ?? 2);
    }
  }, [recommendation]);

  const handleApply = async () => {
    setIsApplying(true);
    try {
      await onApply({
        targetWeightKg: editedWeight,
        repsMin: editedRepsMin,
        repsMax: editedRepsMax,
        targetRir: editedRir,
      });
      onShowToast(
        `Prescripción actualizada para ${recommendation.exerciseName}: ${editedWeight} kg × ${editedRepsMin}-${editedRepsMax} reps @ RIR ${editedRir}`,
        'success'
      );
      onClose();
    } catch {
      onShowToast('Error al actualizar la prescripción', 'warning');
    } finally {
      setIsApplying(false);
    }
  };

  const {
    exerciseName,
    equipment,
    currentPrescription,
    lastPerformance,
    actionBadge,
    confidence,
    confidenceReason,
    reason,
    historicalEvidence,
    limitations,
    plateauStatus,
    plateauReason,
    plateauActionSuggestions,
  } = recommendation;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-surface-container-lowest w-full max-w-2xl rounded-2xl shadow-xl border border-surface-container/70 flex flex-col max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-space-lg border-b border-surface-container/40 flex items-start justify-between gap-space-sm bg-surface-container-low/50">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-label-sm text-xs ${actionBadge.colorClass}`}>
                <span className="material-symbols-outlined text-xs">{actionBadge.icon}</span>
                {actionBadge.label}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-surface-container font-code-data text-xs text-on-surface-variant capitalize">
                Equipamiento: {equipment}
              </span>
              <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${
                confidence === 'high' ? 'bg-primary-fixed/40 text-on-primary-fixed' : confidence === 'medium' ? 'bg-secondary-fixed/40 text-on-secondary-fixed' : 'bg-surface-container text-on-surface-variant'
              }`}>
                Confianza: {confidence.toUpperCase()}
              </span>
            </div>
            <h2 className="font-headline-md text-headline-md font-bold text-on-surface tracking-tight mt-1">
              {exerciseName}
            </h2>
            <p className="font-body-md text-body-md text-on-surface-variant text-xs">
              Asistente de sobrecarga progresiva basada en reglas explícitas y doble progresión.
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
          {/* Rationale Explanation Card */}
          <div className="p-space-md rounded-xl bg-surface-container-low border border-surface-container/50 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 font-label-md text-on-surface font-bold text-xs uppercase tracking-wider">
              <span className="material-symbols-outlined text-primary text-base">psychology</span>
              Motivo de la Recomendación
            </div>
            <p className="font-body-md text-on-surface leading-relaxed text-sm">
              {reason}
            </p>
            <span className="text-xs text-on-surface-variant italic">
              {confidenceReason}
            </span>
          </div>

          {/* Plateau Alert Card (if detected) */}
          {plateauStatus === 'possible_plateau' && (
            <div className="p-space-md rounded-xl bg-amber-50 border border-amber-200 text-amber-950 flex flex-col gap-2">
              <div className="flex items-center gap-1.5 font-bold text-xs uppercase tracking-wider text-amber-900">
                <span className="material-symbols-outlined text-base">warning</span>
                Posible Estancamiento Detectado
              </div>
              <p className="text-xs leading-relaxed">
                {plateauReason}
              </p>
              <div className="mt-1 pt-1 border-t border-amber-200/60 flex flex-col gap-1 text-xs">
                <span className="font-semibold">Acciones sugeridas (opcionales):</span>
                <ul className="list-disc list-inside space-y-0.5 text-amber-900/90 pl-1">
                  {plateauActionSuggestions.map((sug, i) => (
                    <li key={i}>{sug}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Comparison: Current vs Last Performance vs Suggested */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-space-sm">
            {/* Last Performance */}
            <div className="p-space-sm rounded-xl bg-surface-container-low/60 border border-surface-container/40 flex flex-col gap-1">
              <span className="font-label-sm text-xs font-semibold text-on-surface-variant uppercase">
                Última Sesión Comparable
              </span>
              {lastPerformance ? (
                <div className="flex flex-col gap-0.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Fecha:</span>
                    <span className="font-code-data font-semibold">{lastPerformance.date}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Carga & Reps:</span>
                    <span className="font-code-data font-bold text-primary">
                      {lastPerformance.weightKg} kg × {lastPerformance.reps} reps
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">RIR Registrado:</span>
                    <span className="font-code-data">
                      {lastPerformance.rir !== null ? `RIR ${lastPerformance.rir}` : 'No reportado'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-on-surface-variant">Series completadas:</span>
                    <span className="font-code-data">{lastPerformance.completedSets} series</span>
                  </div>
                </div>
              ) : (
                <span className="text-xs text-on-surface-variant italic">Sin datos previos registrados</span>
              )}
            </div>

            {/* Current Planned Prescription */}
            <div className="p-space-sm rounded-xl bg-surface-container-low/60 border border-surface-container/40 flex flex-col gap-1">
              <span className="font-label-sm text-xs font-semibold text-on-surface-variant uppercase">
                Prescripción Planificada Actual
              </span>
              <div className="flex flex-col gap-0.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Series prescritas:</span>
                  <span className="font-code-data font-bold">{currentPrescription.sets} series</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Rango de reps:</span>
                  <span className="font-code-data font-bold">{currentPrescription.repsMin} - {currentPrescription.repsMax} reps</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">RIR objetivo:</span>
                  <span className="font-code-data font-bold text-primary">RIR {currentPrescription.targetRir ?? 2}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant">Carga actual:</span>
                  <span className="font-code-data">{currentPrescription.targetWeightKg ? `${currentPrescription.targetWeightKg} kg` : 'Sin asignar'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Form for User Customization */}
          <div className="p-space-md rounded-xl bg-surface-container border border-surface-container-high flex flex-col gap-space-sm">
            <span className="font-label-md text-xs font-bold uppercase tracking-wider text-on-surface flex items-center gap-1.5">
              <span className="material-symbols-outlined text-primary text-base">tune</span>
              Propuesta para la Próxima Sesión (Modificable)
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-space-sm">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-on-surface-variant font-medium">Carga Sugerida (kg):</label>
                <input
                  type="number"
                  step="0.5"
                  value={editedWeight}
                  onChange={e => setEditedWeight(parseFloat(e.target.value) || 0)}
                  className="bg-surface-container-lowest text-on-surface px-2.5 py-1.5 rounded-lg border border-surface-container font-code-data font-bold text-sm focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-on-surface-variant font-medium">Reps Mínimas:</label>
                <input
                  type="number"
                  value={editedRepsMin}
                  onChange={e => setEditedRepsMin(parseInt(e.target.value, 10) || 1)}
                  className="bg-surface-container-lowest text-on-surface px-2.5 py-1.5 rounded-lg border border-surface-container font-code-data font-bold text-sm focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-on-surface-variant font-medium">Reps Máximas:</label>
                <input
                  type="number"
                  value={editedRepsMax}
                  onChange={e => setEditedRepsMax(parseInt(e.target.value, 10) || 1)}
                  className="bg-surface-container-lowest text-on-surface px-2.5 py-1.5 rounded-lg border border-surface-container font-code-data font-bold text-sm focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-on-surface-variant font-medium">RIR Objetivo:</label>
                <input
                  type="number"
                  min="0"
                  max="5"
                  value={editedRir}
                  onChange={e => setEditedRir(parseInt(e.target.value, 10) || 0)}
                  className="bg-surface-container-lowest text-on-surface px-2.5 py-1.5 rounded-lg border border-surface-container font-code-data font-bold text-sm focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>
            <span className="text-[11px] text-on-surface-variant">
              El usuario conserva el control absoluto. Puedes ajustar libremente los valores antes de aplicar.
            </span>
          </div>

          {/* Historical Evidence Accordion / Table */}
          {historicalEvidence.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="font-label-sm text-xs font-semibold text-on-surface uppercase">
                Evidencia Histórica de Sesiones Comparables ({historicalEvidence.length})
              </span>
              <div className="overflow-x-auto rounded-lg border border-surface-container/50">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-container-low text-on-surface-variant font-semibold">
                    <tr>
                      <th className="py-1.5 px-3">Fecha</th>
                      <th className="py-1.5 px-3">Rutina</th>
                      <th className="py-1.5 px-3 text-right">Carga</th>
                      <th className="py-1.5 px-3 text-right">Reps</th>
                      <th className="py-1.5 px-3 text-center">RIR</th>
                      <th className="py-1.5 px-3 text-right">1RM Epley</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-container/30 font-code-data">
                    {historicalEvidence.map((ev, i) => (
                      <tr key={i} className="hover:bg-surface-container-low/50">
                        <td className="py-1.5 px-3 text-on-surface-variant">{ev.date}</td>
                        <td className="py-1.5 px-3 text-on-surface font-sans truncate max-w-[140px]">{ev.routineName}</td>
                        <td className="py-1.5 px-3 text-right font-bold text-primary">{ev.bestWeightKg} kg</td>
                        <td className="py-1.5 px-3 text-right">{ev.bestReps} reps</td>
                        <td className="py-1.5 px-3 text-center">{ev.averageRir !== null ? `RIR ${ev.averageRir}` : '—'}</td>
                        <td className="py-1.5 px-3 text-right font-semibold">{Math.max(...ev.effectiveSets.map(s => s.estimated1RM))} kg</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Limitations Disclosure */}
          {limitations.length > 0 && (
            <div className="p-2.5 rounded-lg bg-surface-container-low text-on-surface-variant text-xs flex flex-col gap-1">
              <span className="font-semibold text-on-surface">Transparencia y limitaciones:</span>
              {limitations.map((lim, i) => (
                <span key={i}>• {lim}</span>
              ))}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-space-md border-t border-surface-container/40 flex items-center justify-between gap-space-sm bg-surface-container-low/30">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-on-surface-variant hover:bg-surface-container hover:text-on-surface font-label-md text-xs font-semibold transition-colors cursor-pointer"
          >
            Descartar / Cancelar
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={isApplying}
            className="px-5 py-2 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-xs font-bold shadow-xs transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-sm">check</span>
            <span>{isApplying ? 'Aplicando...' : 'Aceptar para Próxima Sesión'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
