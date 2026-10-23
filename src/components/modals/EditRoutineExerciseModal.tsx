import React, { useState } from 'react';
import { PlannedExerciseConfig } from '../../types/workout';
import { getExerciseById } from '../../data/exerciseCatalog';

interface EditRoutineExerciseModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: PlannedExerciseConfig;
  onSave: (updates: Partial<PlannedExerciseConfig>) => Promise<void>;
  onDelete: () => Promise<void>;
}

export const EditRoutineExerciseModal: React.FC<EditRoutineExerciseModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
  onDelete,
}) => {
  const exercise = getExerciseById(config.exerciseId);

  const [sets, setSets] = useState(config.sets);
  const [repsMin, setRepsMin] = useState(config.repsMin);
  const [repsMax, setRepsMax] = useState(config.repsMax);
  const [targetRir, setTargetRir] = useState(config.targetRir ?? 2);
  const [restSeconds, setRestSeconds] = useState(config.restSeconds);
  const [tempo, setTempo] = useState(config.tempo ?? '');
  const [notes, setNotes] = useState(config.notes ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSave({
        sets,
        repsMin,
        repsMax,
        targetRir,
        restSeconds,
        tempo: tempo.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsSaving(true);
    try {
      await onDelete();
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-surface-container-lowest rounded-2xl max-w-lg w-full shadow-xl border border-surface-container flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-space-md border-b border-surface-container flex items-center justify-between bg-surface-container-low">
          <div className="flex flex-col">
            <span className="font-label-sm text-label-sm text-primary font-bold uppercase tracking-wider text-[11px]">
              Ajustar Parámetros de Trabajo
            </span>
            <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">
              {exercise?.name || config.exerciseId}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-space-md flex flex-col gap-space-md">
          <div className="grid grid-cols-2 gap-space-sm">
            <div className="flex flex-col gap-1">
              <label className="font-label-sm text-label-sm text-on-surface-variant">
                Series Efectivas
              </label>
              <input
                type="number"
                min={1}
                max={10}
                value={sets}
                onChange={e => setSets(Math.max(1, parseInt(e.target.value) || 1))}
                className="p-2.5 rounded-xl bg-surface-container-low border border-surface-container font-headline-sm text-base text-on-surface font-bold text-center"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-sm text-label-sm text-on-surface-variant">
                RIR Objetivo
              </label>
              <select
                value={targetRir}
                onChange={e => setTargetRir(parseInt(e.target.value))}
                className="p-2.5 rounded-xl bg-surface-container-low border border-surface-container font-headline-sm text-base text-on-surface font-bold text-center"
              >
                <option value={0}>RIR 0 (Fallo técnico)</option>
                <option value={1}>RIR 1 (1 rep en reserva)</option>
                <option value={2}>RIR 2 (2 reps en reserva)</option>
                <option value={3}>RIR 3 (3 reps en reserva)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-sm text-label-sm text-on-surface-variant">
                Reps Mínimas
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={repsMin}
                onChange={e => setRepsMin(Math.max(1, parseInt(e.target.value) || 1))}
                className="p-2.5 rounded-xl bg-surface-container-low border border-surface-container font-headline-sm text-base text-on-surface font-bold text-center"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-sm text-label-sm text-on-surface-variant">
                Reps Máximas
              </label>
              <input
                type="number"
                min={repsMin}
                max={50}
                value={repsMax}
                onChange={e => setRepsMax(Math.max(repsMin, parseInt(e.target.value) || repsMin))}
                className="p-2.5 rounded-xl bg-surface-container-low border border-surface-container font-headline-sm text-base text-on-surface font-bold text-center"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-sm text-label-sm text-on-surface-variant">
                Descanso entre series
              </label>
              <select
                value={restSeconds}
                onChange={e => setRestSeconds(parseInt(e.target.value))}
                className="p-2.5 rounded-xl bg-surface-container-low border border-surface-container font-headline-sm text-base text-on-surface font-bold text-center"
              >
                <option value={45}>45 seg</option>
                <option value={60}>60 seg (1 min)</option>
                <option value={90}>90 seg (1.5 min)</option>
                <option value={120}>120 seg (2 min)</option>
                <option value={150}>150 seg (2.5 min)</option>
                <option value={180}>180 seg (3 min)</option>
                <option value={240}>240 seg (4 min)</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="font-label-sm text-label-sm text-on-surface-variant">
                Tempo (ej: 3-0-1-0)
              </label>
              <input
                type="text"
                value={tempo}
                onChange={e => setTempo(e.target.value)}
                placeholder="3-0-1-0"
                className="p-2.5 rounded-xl bg-surface-container-low border border-surface-container font-code-data text-sm text-on-surface text-center"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="font-label-sm text-label-sm text-on-surface-variant">
              Pauta Técnica y Cues de Ejecución
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Instrucciones biomecánicas, puntos de estiramiento..."
              className="p-2.5 rounded-xl bg-surface-container-low border border-surface-container text-xs text-on-surface focus:outline-hidden"
            />
          </div>

          {/* Delete Option or Confirm */}
          {showConfirmDelete ? (
            <div className="p-3 rounded-xl bg-error/10 border border-error/30 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-error text-xs font-medium">
                <span className="material-symbols-outlined text-base">warning</span>
                <span>¿Retirar este ejercicio del día?</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowConfirmDelete(false)}
                  className="px-2.5 py-1 rounded-lg bg-surface-container text-on-surface text-xs font-label-sm cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  className="px-2.5 py-1 rounded-lg bg-error text-on-error text-xs font-label-sm font-bold cursor-pointer"
                >
                  Eliminar
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-start">
              <button
                type="button"
                onClick={() => setShowConfirmDelete(true)}
                className="text-error hover:text-error/80 text-xs font-label-sm flex items-center gap-1 cursor-pointer"
              >
                <span className="material-symbols-outlined text-sm">delete</span>
                <span>Retirar ejercicio de la rutina</span>
              </button>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center gap-space-xs pt-space-xs border-t border-surface-container">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md transition-colors cursor-pointer text-center"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 py-2.5 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-bold shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-base">save</span>
              <span>{isSaving ? 'Guardando...' : 'Guardar Cambios'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
