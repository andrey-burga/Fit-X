import React, { useState, useEffect } from 'react';
import { GroceryDepartment, GroceryItem } from '../../types';

interface EditGroceryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, quantity: number, unit: string, department: GroceryDepartment, notes?: string) => void;
  initialItem?: GroceryItem | null;
}

export const EditGroceryModal: React.FC<EditGroceryModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialItem,
}) => {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState('kg');
  const [department, setDepartment] = useState<GroceryDepartment>('carnes');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (initialItem) {
      setName(initialItem.name);
      setQuantity(initialItem.quantity);
      setUnit(initialItem.unit);
      setDepartment(initialItem.department);
      setNotes(initialItem.notes || '');
    } else {
      setName('');
      setQuantity(1);
      setUnit('kg');
      setDepartment('carnes');
      setNotes('');
    }
  }, [initialItem, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave(name.trim(), Number(quantity), unit, department, notes.trim() || undefined);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-space-md bg-inverse-surface/40 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-surface-container-lowest rounded-xl max-w-md w-full p-space-lg shadow-xl flex flex-col gap-space-md animate-in zoom-in-95 duration-150 border border-surface-container/60">
        <div className="flex items-center justify-between pb-2 border-b border-surface-container/40">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-xl">
              {initialItem ? 'edit_note' : 'add_circle'}
            </span>
            <h3 className="font-headline-sm text-headline-sm text-on-surface font-semibold">
              {initialItem ? 'Editar Insumo' : 'Añadir Insumo a Lista'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-on-surface-variant hover:bg-surface-container transition-colors"
            type="button"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-space-sm">
          <div className="flex flex-col gap-space-xs">
            <label className="font-label-md text-label-md text-on-surface font-medium">
              Nombre del alimento
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Ej. Pechuga de pollo, Huevos, Avena..."
              className="h-9 px-space-sm bg-surface-container-low text-on-surface font-body-md text-body-md rounded-lg focus:outline-none focus:bg-surface-container-lowest border border-surface-container focus:ring-1 focus:ring-primary"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-space-sm">
            <div className="flex flex-col gap-space-xs">
              <label className="font-label-md text-label-md text-on-surface font-medium">
                Cantidad
              </label>
              <input
                type="number"
                step="0.05"
                min="0.01"
                value={quantity}
                onChange={e => setQuantity(Number(e.target.value))}
                className="h-9 px-space-sm bg-surface-container-low text-on-surface font-body-md text-body-md rounded-lg focus:outline-none border border-surface-container tabular-nums"
                required
              />
            </div>
            <div className="flex flex-col gap-space-xs">
              <label className="font-label-md text-label-md text-on-surface font-medium">
                Unidad métrica
              </label>
              <select
                value={unit}
                onChange={e => setUnit(e.target.value)}
                className="h-9 px-space-sm bg-surface-container-low text-on-surface font-body-md text-body-md rounded-lg focus:outline-none border border-surface-container"
              >
                <option value="kg">Kilogramos (kg)</option>
                <option value="g">Gramos (g)</option>
                <option value="unid">Unidades (unid)</option>
                <option value="ml">Mililitros (ml)</option>
                <option value="latas">Latas</option>
                <option value="paquete">Paquete</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-space-xs">
            <label className="font-label-md text-label-md text-on-surface font-medium">
              Departamento
            </label>
            <select
              value={department}
              onChange={e => setDepartment(e.target.value as GroceryDepartment)}
              className="h-9 px-space-sm bg-surface-container-low text-on-surface font-body-md text-body-md rounded-lg focus:outline-none border border-surface-container"
            >
              <option value="carnes">Carnes y Pescados</option>
              <option value="huevos">Huevos y Lácteos</option>
              <option value="verduras">Verduras y Frutas</option>
              <option value="carbohidratos">Carbohidratos y Cereales</option>
              <option value="grasas">Grasas y Suplementos</option>
            </select>
          </div>

          <div className="flex flex-col gap-space-xs">
            <label className="font-label-md text-label-md text-on-surface font-medium">
              Notas u observaciones (opcional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Ej. Marca específica, presentación en bandeja..."
              className="h-9 px-space-sm bg-surface-container-low text-on-surface font-body-md text-body-md rounded-lg focus:outline-none border border-surface-container"
            />
          </div>

          {initialItem?.calculatedQuantity !== undefined && (
            <div className="p-space-xs bg-primary-fixed/30 rounded-lg flex items-center justify-between text-xs text-on-surface">
              <span className="flex items-center gap-1 font-code-data text-code-data">
                <span className="material-symbols-outlined text-sm text-primary">analytics</span>
                <span>Plan Semanal prescribió:</span>
              </span>
              <span className="font-semibold tabular-nums text-primary">
                {initialItem.calculatedQuantity} {initialItem.unit}
              </span>
            </div>
          )}

          <div className="p-space-xs bg-surface-container-low rounded-lg flex items-start gap-space-xs text-on-surface-variant text-xs">
            <span className="material-symbols-outlined text-sm text-primary shrink-0 mt-0.5">verified_user</span>
            <span className="font-code-data text-code-data leading-relaxed">
              {initialItem?.origin === 'plan'
                ? 'Política de sincronización: Al editar la cantidad, tu ajuste se protegerá y no será sobrescrito por regeneraciones automáticas del menú.'
                : 'Este insumo manual permanecerá intacto en tu lista independientemente de los cambios del menú semanal.'}
            </span>
          </div>

          <div className="flex items-center justify-end gap-space-sm mt-space-xs pt-2 border-t border-surface-container/50">
            <button
              onClick={onClose}
              type="button"
              className="px-space-md py-1.5 text-on-surface hover:bg-surface-container font-label-md text-label-md rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-space-md py-1.5 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg transition-colors shadow-sm font-medium"
            >
              Guardar Cambios
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
