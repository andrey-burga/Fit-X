import React, { useState, useMemo } from 'react';
import { EXERCISE_CATALOG, searchExercises } from '../../data/exerciseCatalog';
import { ExerciseItem, MuscleGroup, PlannedExerciseConfig, RoutineDay } from '../../types/workout';

interface AddExerciseToRoutineModalProps {
  isOpen: boolean;
  onClose: () => void;
  day: RoutineDay;
  onAddExercise: (exerciseId: string, config: Partial<PlannedExerciseConfig>) => Promise<void>;
}

export const AddExerciseToRoutineModal: React.FC<AddExerciseToRoutineModalProps> = ({
  isOpen,
  onClose,
  day,
  onAddExercise,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMuscle, setSelectedMuscle] = useState<MuscleGroup | 'todos'>('todos');
  const [selectedExercise, setSelectedExercise] = useState<ExerciseItem | null>(null);

  // Default configuration for the new exercise
  const [sets, setSets] = useState(3);
  const [repsMin, setRepsMin] = useState(8);
  const [repsMax, setRepsMax] = useState(10);
  const [targetRir, setTargetRir] = useState(2);
  const [restSeconds, setRestSeconds] = useState(90);
  const [tempo, setTempo] = useState('2-0-1-0');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const filteredExercises = useMemo(() => {
    return searchExercises(searchQuery, selectedMuscle);
  }, [searchQuery, selectedMuscle]);

  if (!isOpen) return null;

  const handleSelect = (ex: ExerciseItem) => {
    setSelectedExercise(ex);
    // Suggest intelligent defaults based on compound vs isolation
    if (ex.movementPattern === 'sentadilla' || ex.movementPattern === 'empuje_horizontal' || ex.movementPattern === 'traccion_horizontal') {
      setSets(4);
      setRepsMin(6);
      setRepsMax(8);
      setRestSeconds(150);
      setTargetRir(2);
    } else if (ex.movementPattern === 'aislamiento') {
      setSets(3);
      setRepsMin(12);
      setRepsMax(15);
      setRestSeconds(60);
      setTargetRir(1);
    } else {
      setSets(3);
      setRepsMin(8);
      setRepsMax(10);
      setRestSeconds(90);
      setTargetRir(2);
    }
    setNotes(ex.instructions?.[0] || '');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExercise) return;
    setIsSubmitting(true);
    try {
      await onAddExercise(selectedExercise.id, {
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
      setIsSubmitting(false);
    }
  };

  const muscleChips: { id: MuscleGroup | 'todos'; label: string }[] = [
    { id: 'todos', label: 'Todos' },
    { id: 'pecho', label: 'Pecho' },
    { id: 'espalda', label: 'Espalda' },
    { id: 'hombros', label: 'Hombros' },
    { id: 'cuadriceps', label: 'Cuádriceps' },
    { id: 'isquios', label: 'Isquios' },
    { id: 'gluteos', label: 'Glúteos' },
    { id: 'biceps', label: 'Bíceps' },
    { id: 'triceps', label: 'Tríceps' },
    { id: 'core', label: 'Core' },
    { id: 'cuerpo_completo', label: 'Full Body' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-surface-container-lowest rounded-2xl max-w-4xl w-full max-h-[90vh] shadow-xl border border-surface-container flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-space-md border-b border-surface-container flex items-center justify-between bg-surface-container-low">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-xl">fitness_center</span>
              <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">
                Añadir Ejercicio al {day.name}
              </h2>
            </div>
            <p className="font-body-md text-body-md text-on-surface-variant text-xs">
              Selecciona un ejercicio del catálogo canónico de fuerza y personaliza sus series y repeticiones.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Content: 2-Column Split */}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-surface-container">
          {/* Left Column (7 Cols): Search and Catalog List */}
          <div className="md:col-span-7 p-space-md flex flex-col gap-space-sm overflow-y-auto max-h-[70vh]">
            {/* Search Input */}
            <div className="relative">
              <span className="material-symbols-outlined absolute left-3 top-2.5 text-on-surface-variant text-lg">
                search
              </span>
              <input
                type="text"
                placeholder="Buscar por nombre, equipamiento (barra, polea...)"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl bg-surface-container-low border border-surface-container text-on-surface font-body-md text-body-md focus:outline-hidden focus:border-primary"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-2.5 text-on-surface-variant hover:text-on-surface"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              )}
            </div>

            {/* Muscle Chips Filter */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {muscleChips.map(chip => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setSelectedMuscle(chip.id)}
                  className={`px-2.5 py-1 rounded-full text-xs font-label-sm shrink-0 transition-colors cursor-pointer ${
                    selectedMuscle === chip.id
                      ? 'bg-primary text-on-primary font-semibold'
                      : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                  }`}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* List */}
            <div className="flex flex-col gap-1.5 mt-1">
              <span className="font-label-sm text-label-sm uppercase tracking-wider text-on-surface-variant font-semibold text-[11px]">
                {filteredExercises.length} Ejercicios Disponibles
              </span>
              {filteredExercises.length === 0 ? (
                <div className="p-8 text-center text-on-surface-variant flex flex-col items-center gap-2">
                  <span className="material-symbols-outlined text-3xl text-secondary">search_off</span>
                  <p className="font-body-md text-body-md">No se encontraron ejercicios con ese criterio.</p>
                </div>
              ) : (
                filteredExercises.map(ex => {
                  const isSelected = selectedExercise?.id === ex.id;
                  return (
                    <button
                      key={ex.id}
                      type="button"
                      onClick={() => handleSelect(ex)}
                      className={`p-3 rounded-xl border text-left transition-all flex items-start justify-between gap-2 cursor-pointer ${
                        isSelected
                          ? 'bg-primary/10 border-primary shadow-xs'
                          : 'bg-surface-container-low border-surface-container/60 hover:bg-surface-container'
                      }`}
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-headline-sm text-sm font-semibold text-on-surface">
                            {ex.name}
                          </span>
                          {isSelected && (
                            <span className="material-symbols-outlined text-primary text-base">check_circle</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-on-surface-variant font-label-sm">
                          <span className="capitalize text-primary font-medium">{ex.muscleGroup}</span>
                          <span>•</span>
                          <span className="capitalize">{ex.equipment}</span>
                          <span>•</span>
                          <span className="capitalize">{ex.movementPattern.replace('_', ' ')}</span>
                        </div>
                      </div>
                      <span className="material-symbols-outlined text-on-surface-variant text-base mt-1">
                        chevron_right
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column (5 Cols): Selected Exercise Config */}
          <div className="md:col-span-5 p-space-md flex flex-col justify-between bg-surface-container-lowest">
            {selectedExercise ? (
              <form onSubmit={handleSubmit} className="flex flex-col gap-space-md h-full justify-between">
                <div className="flex flex-col gap-space-sm">
                  {/* Selected Header */}
                  <div className="p-space-sm rounded-xl bg-surface-container-low border border-surface-container flex flex-col gap-1">
                    <span className="font-label-sm text-label-sm uppercase tracking-wider text-primary font-bold text-[11px]">
                      Configurar Parámetros de Trabajo
                    </span>
                    <h3 className="font-headline-sm text-headline-sm font-bold text-on-surface">
                      {selectedExercise.name}
                    </h3>
                    <p className="text-xs text-on-surface-variant">
                      Grupo: <strong className="capitalize text-on-surface">{selectedExercise.muscleGroup}</strong> | Equipamiento:{' '}
                      <strong className="capitalize text-on-surface">{selectedExercise.equipment}</strong>
                    </p>
                  </div>

                  {/* Config Grid */}
                  <div className="grid grid-cols-2 gap-space-xs">
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
                        className="p-2 rounded-lg bg-surface-container-low border border-surface-container font-headline-sm text-base text-on-surface font-bold text-center"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="font-label-sm text-label-sm text-on-surface-variant">
                        RIR Objetivo
                      </label>
                      <select
                        value={targetRir}
                        onChange={e => setTargetRir(parseInt(e.target.value))}
                        className="p-2 rounded-lg bg-surface-container-low border border-surface-container font-headline-sm text-base text-on-surface font-bold text-center"
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
                        className="p-2 rounded-lg bg-surface-container-low border border-surface-container font-headline-sm text-base text-on-surface font-bold text-center"
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
                        className="p-2 rounded-lg bg-surface-container-low border border-surface-container font-headline-sm text-base text-on-surface font-bold text-center"
                      />
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="font-label-sm text-label-sm text-on-surface-variant">
                        Descanso (segundos)
                      </label>
                      <select
                        value={restSeconds}
                        onChange={e => setRestSeconds(parseInt(e.target.value))}
                        className="p-2 rounded-lg bg-surface-container-low border border-surface-container font-headline-sm text-base text-on-surface font-bold text-center"
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
                        className="p-2 rounded-lg bg-surface-container-low border border-surface-container font-code-data text-sm text-on-surface text-center"
                      />
                    </div>
                  </div>

                  {/* Notes / Cues */}
                  <div className="flex flex-col gap-1">
                    <label className="font-label-sm text-label-sm text-on-surface-variant">
                      Pauta Técnica / Notas
                    </label>
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="Ej: Pausa en el punto de estiramiento..."
                      className="p-2 rounded-lg bg-surface-container-low border border-surface-container text-xs text-on-surface focus:outline-hidden"
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-space-xs pt-space-md border-t border-surface-container">
                  <button
                    type="button"
                    onClick={() => setSelectedExercise(null)}
                    className="flex-1 py-2.5 px-3 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-label-md transition-colors cursor-pointer text-center"
                  >
                    Volver
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-2 py-2.5 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md font-bold shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    <span className="material-symbols-outlined text-base">add_circle</span>
                    <span>{isSubmitting ? 'Añadiendo...' : 'Añadir al Día'}</span>
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-8 text-on-surface-variant my-auto gap-3">
                <span className="w-12 h-12 rounded-full bg-surface-container-low flex items-center justify-center material-symbols-outlined text-2xl text-primary">
                  touch_app
                </span>
                <div className="flex flex-col">
                  <h4 className="font-headline-sm text-sm font-semibold text-on-surface">
                    Selecciona un Ejercicio
                  </h4>
                  <p className="font-body-md text-body-md text-xs mt-0.5">
                    Elige un ejercicio del catálogo a la izquierda para configurar series, repeticiones y descansos.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
