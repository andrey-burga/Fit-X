import React, { useState } from 'react';
import { WorkoutRoutine } from '../../types/workout';
import { MASTER_WORKOUT_TEMPLATES } from '../../data/workoutTemplates';

interface ManageRoutinesModalProps {
  isOpen: boolean;
  onClose: () => void;
  routines: WorkoutRoutine[];
  activeRoutineId: string | null;
  onSelectRoutine: (id: string) => void;
  onCreateFromTemplate: (templateId: string, customName?: string) => Promise<string>;
  onRenameRoutine: (id: string, newName: string) => Promise<void>;
  onDeleteRoutine: (id: string) => Promise<void>;
}

export const ManageRoutinesModal: React.FC<ManageRoutinesModalProps> = ({
  isOpen,
  onClose,
  routines,
  activeRoutineId,
  onSelectRoutine,
  onCreateFromTemplate,
  onRenameRoutine,
  onDeleteRoutine,
}) => {
  const [activeTab, setActiveTab] = useState<'mis_rutinas' | 'plantillas'>('mis_rutinas');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  if (!isOpen) return null;

  const handleStartRename = (routine: WorkoutRoutine) => {
    setEditingId(routine.id);
    setRenameText(routine.name);
  };

  const handleSaveRename = async (id: string) => {
    if (!renameText.trim()) return;
    setIsLoading(true);
    try {
      await onRenameRoutine(id, renameText.trim());
      setEditingId(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmDelete = async (id: string) => {
    setIsLoading(true);
    try {
      await onDeleteRoutine(id);
      setDeletingId(null);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateTemplate = async (templateId: string) => {
    setIsLoading(true);
    try {
      await onCreateFromTemplate(templateId);
      setActiveTab('mis_rutinas');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-scrim/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-surface-container-lowest rounded-2xl max-w-2xl w-full shadow-xl border border-surface-container flex flex-col overflow-hidden max-h-[85vh]">
        {/* Header */}
        <div className="p-space-md border-b border-surface-container flex items-center justify-between bg-surface-container-low">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl">tune</span>
            <div className="flex flex-col">
              <h2 className="font-headline-sm text-headline-sm font-bold text-on-surface">
                Gestión de Rutinas y Mesociclos
              </h2>
              <p className="font-body-md text-xs text-on-surface-variant">
                Selecciona, personaliza o crea copias independientes de plantillas maestras.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors cursor-pointer"
            type="button"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex items-center gap-2 p-2 bg-surface-container-low border-b border-surface-container">
          <button
            type="button"
            onClick={() => setActiveTab('mis_rutinas')}
            className={`flex-1 py-2 px-3 rounded-xl font-label-md text-label-md font-semibold transition-all cursor-pointer ${
              activeTab === 'mis_rutinas'
                ? 'bg-surface-container-lowest text-primary shadow-xs'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Mis Rutinas Activas ({routines.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('plantillas')}
            className={`flex-1 py-2 px-3 rounded-xl font-label-md text-label-md font-semibold transition-all cursor-pointer ${
              activeTab === 'plantillas'
                ? 'bg-surface-container-lowest text-primary shadow-xs'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Plantillas Maestras ({MASTER_WORKOUT_TEMPLATES.length})
          </button>
        </div>

        {/* Body Content */}
        <div className="p-space-md overflow-y-auto flex flex-col gap-space-sm flex-1">
          {activeTab === 'mis_rutinas' ? (
            routines.length === 0 ? (
              <div className="p-8 text-center text-on-surface-variant flex flex-col items-center gap-3 my-auto">
                <span className="material-symbols-outlined text-4xl text-primary">fitness_center</span>
                <div className="flex flex-col">
                  <h3 className="font-headline-sm text-base font-semibold text-on-surface">
                    No tienes rutinas personalizadas aún
                  </h3>
                  <p className="font-body-md text-xs text-on-surface-variant mt-1">
                    Crea una copia independiente a partir de una de nuestras plantillas científicamente fundamentadas.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('plantillas')}
                  className="mt-2 px-4 py-2 bg-primary text-on-primary rounded-xl font-label-md text-label-md font-bold shadow-xs cursor-pointer hover:bg-primary-container"
                >
                  Explorar Plantillas
                </button>
              </div>
            ) : (
              routines.map(routine => {
                const isActive = routine.id === activeRoutineId;
                const totalExercises = routine.days.reduce((acc, d) => acc + d.exercises.length, 0);
                const totalSets = routine.days.reduce(
                  (acc, d) => acc + d.exercises.reduce((sAcc, ex) => sAcc + ex.sets, 0),
                  0
                );

                return (
                  <div
                    key={routine.id}
                    className={`p-space-sm rounded-xl border transition-all flex flex-col gap-space-xs ${
                      isActive
                        ? 'bg-primary/5 border-primary shadow-xs'
                        : 'bg-surface-container-low border-surface-container/70 hover:border-surface-container-high'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2 flex-1">
                        <span
                          className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                            isActive ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
                          }`}
                        >
                          {routine.frequencyDays}D
                        </span>

                        <div className="flex flex-col flex-1">
                          {editingId === routine.id ? (
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                value={renameText}
                                onChange={e => setRenameText(e.target.value)}
                                className="px-2 py-1 rounded bg-surface-container-lowest border border-primary text-sm font-semibold text-on-surface flex-1"
                              />
                              <button
                                type="button"
                                onClick={() => handleSaveRename(routine.id)}
                                className="px-2.5 py-1 bg-primary text-on-primary rounded text-xs font-bold"
                              >
                                Guardar
                              </button>
                              <button
                                type="button"
                                onClick={() => setEditingId(null)}
                                className="px-2 py-1 bg-surface-container text-on-surface text-xs"
                              >
                                Cancelar
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="font-headline-sm text-base font-bold text-on-surface">
                                {routine.name}
                              </h3>
                              {isActive && (
                                <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-bold">
                                  Activa
                                </span>
                              )}
                            </div>
                          )}

                          <p className="text-xs text-on-surface-variant mt-0.5 line-clamp-2">
                            {routine.description}
                          </p>

                          <div className="flex items-center gap-3 text-xs text-on-surface-variant mt-1 font-code-data">
                            <span>{routine.days.length} Días estructurados</span>
                            <span>•</span>
                            <span>{totalExercises} Ejercicios</span>
                            <span>•</span>
                            <span>{totalSets} Series Semanales</span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        {!isActive && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectRoutine(routine.id);
                              onClose();
                            }}
                            className="px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface text-xs font-semibold cursor-pointer"
                          >
                            Activar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleStartRename(routine)}
                          className="p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container cursor-pointer"
                          title="Renombrar rutina"
                        >
                          <span className="material-symbols-outlined text-base">edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingId(routine.id)}
                          className="p-1.5 rounded-lg text-error/80 hover:text-error hover:bg-error/10 cursor-pointer"
                          title="Eliminar rutina"
                        >
                          <span className="material-symbols-outlined text-base">delete</span>
                        </button>
                      </div>
                    </div>

                    {/* Delete Confirmation Box */}
                    {deletingId === routine.id && (
                      <div className="mt-2 p-3 rounded-lg bg-error/10 border border-error/30 flex items-center justify-between gap-2">
                        <span className="text-error text-xs font-medium">
                          ¿Confirmas que deseas eliminar permanentemente esta rutina?
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDeletingId(null)}
                            className="px-2.5 py-1 rounded bg-surface-container text-on-surface text-xs"
                          >
                            Cancelar
                          </button>
                          <button
                            type="button"
                            disabled={isLoading}
                            onClick={() => handleConfirmDelete(routine.id)}
                            className="px-2.5 py-1 rounded bg-error text-on-error text-xs font-bold"
                          >
                            {isLoading ? 'Eliminando...' : 'Eliminar'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )
          ) : (
            MASTER_WORKOUT_TEMPLATES.map(tpl => {
              const totalExercises = tpl.days.reduce((acc, d) => acc + d.exercises.length, 0);
              const totalSets = tpl.days.reduce(
                (acc, d) => acc + d.exercises.reduce((sAcc, ex) => sAcc + ex.sets, 0),
                0
              );

              return (
                <div
                  key={tpl.id}
                  className="p-space-md rounded-xl bg-surface-container-low border border-surface-container/80 flex flex-col gap-space-xs hover:border-primary/50 transition-all"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-bold text-xs">
                          {tpl.frequencyDays} Días / Semana
                        </span>
                        <span className="capitalize text-xs text-on-surface-variant font-medium">
                          Objetivo: {tpl.goal}
                        </span>
                      </div>
                      <h3 className="font-headline-sm text-base font-bold text-on-surface mt-1">
                        {tpl.name}
                      </h3>
                      <p className="font-body-md text-xs text-on-surface-variant mt-0.5">
                        {tpl.description}
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => handleCreateTemplate(tpl.id)}
                      className="px-3.5 py-2 bg-primary hover:bg-primary-container text-on-primary rounded-xl font-label-md text-xs font-bold shadow-xs cursor-pointer shrink-0 flex items-center gap-1.5 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-sm">content_copy</span>
                      <span>Usar Plantilla</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-surface-container/50 text-xs text-on-surface-variant font-code-data">
                    <div className="flex flex-col">
                      <span className="uppercase text-[10px] text-on-surface-variant/70 font-semibold">
                        Días
                      </span>
                      <span className="font-bold text-on-surface">{tpl.days.length} días</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="uppercase text-[10px] text-on-surface-variant/70 font-semibold">
                        Ejercicios
                      </span>
                      <span className="font-bold text-on-surface">{totalExercises} asignados</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="uppercase text-[10px] text-on-surface-variant/70 font-semibold">
                        Volumen
                      </span>
                      <span className="font-bold text-on-surface">{totalSets} series / sem</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="uppercase text-[10px] text-on-surface-variant/70 font-semibold">
                        Frecuencia
                      </span>
                      <span className="font-bold text-primary font-semibold">Frecuencia 2</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-space-sm border-t border-surface-container bg-surface-container-low flex justify-between items-center">
          <span className="text-xs text-on-surface-variant">
            Las plantillas son puntos de partida editables que puedes personalizar libremente.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-surface-container hover:bg-surface-container-high text-on-surface rounded-xl font-label-md text-xs font-semibold cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};
