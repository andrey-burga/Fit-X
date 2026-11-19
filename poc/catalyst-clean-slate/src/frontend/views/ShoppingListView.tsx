/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Synchronized Shopping List View
 * Computes idempotent diff against active MealPlan + Recipes while honoring
 * Catalyst NoSQL <= 25 items batch write partitioning.
 */

import React, { useMemo, useState } from 'react';
import { CheckSquare, Plus, RefreshCw, ShoppingCart, Square, Trash2 } from 'lucide-react';
import {
  CATALYST_BUDGET_LIMITS,
  type GroceryDepartment,
} from '../contracts/cleanSlateModels';
import { computeIdempotentGrocerySync, type GrocerySyncDiff } from '../domain/nutritionEngine';
import { useWorkspace } from '../state/WorkspaceContext';
import { InlineAlert, SectionCard, StatTile, StatePanel } from '../components/UiPrimitives';

const DEPARTMENT_LABELS: Record<GroceryDepartment | 'all', string> = {
  all: 'Todos los pasillos',
  carnes: 'Carnes y Pescados',
  huevos: 'Huevos y Lácteos',
  verduras: 'Verduras y Frutas',
  carbohidratos: 'Granos y Carbohidratos',
  grasas: 'Grasas y Frutos Secos',
};

export const ShoppingListView: React.FC = () => {
  const { workspace, syncGroceries, toggleGrocery, addManualGrocery, deleteGrocery, navigate, isLocalDevMock } = useWorkspace();

  const [deptFilter, setDeptFilter] = useState<GroceryDepartment | 'all'>('all');
  const [lastSyncDiff, setLastSyncDiff] = useState<GrocerySyncDiff | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [manualName, setManualName] = useState('');
  const [manualQty, setManualQty] = useState(1);
  const [manualUnit, setManualUnit] = useState('unidad');
  const [manualDept, setManualDept] = useState<GroceryDepartment>('verduras');

  const activePlan = workspace?.mealPlans[0];
  const groceries = workspace?.groceries ?? [];

  const previewDiff = useMemo(
    () =>
      computeIdempotentGrocerySync(
        groceries,
        activePlan,
        workspace?.recipes ?? []
      ),
    [groceries, activePlan, workspace?.recipes]
  );

  const filteredGroceries = useMemo(
    () => (deptFilter === 'all' ? groceries : groceries.filter(g => g.department === deptFilter)),
    [groceries, deptFilter]
  );

  if (!workspace) return null;

  const boughtCount = groceries.filter(g => g.status === 'bought').length;
  const pendingCount = groceries.filter(g => g.status === 'pending').length;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncGroceries(previewDiff.items);
      setLastSyncDiff(previewDiff);
    } finally {
      setSyncing(false);
    }
  };

  const handleAddManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualName.trim()) return;
    await addManualGrocery({
      name: manualName.trim(),
      quantity: Math.max(0.1, manualQty),
      unit: manualUnit.trim() || 'unidad',
      department: manualDept,
      status: 'pending',
      origin: 'manual',
    });
    setManualName('');
    setManualQty(1);
  };

  return (
    <div className="space-y-6">
      {/* KPI summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Artículos Totales" value={groceries.length} detail="Plan + Manuales" />
        <StatTile label="Pendientes" value={pendingCount} tone={pendingCount > 0 ? 'warn' : 'brand'} detail="Por comprar" />
        <StatTile label="Comprados" value={boughtCount} tone="brand" detail="Preservados al resincronizar" />
        <StatTile
          label="Lotes Contractuales"
          value={previewDiff.estimatedBatchCalls}
          tone="info"
          detail={`Máx. ${CATALYST_BUDGET_LIMITS.MAX_BATCH_WRITE_ITEMS} ítems/lote`}
        />
      </div>

      {/* Idempotent Sync Banner */}
      <SectionCard
        title="Sincronización Idempotente con Menú Semanal"
        subtitle={
          activePlan
            ? `Plan activo: ${activePlan.label} (${activePlan.weekStart}) · ${isLocalDevMock ? 'Estado en memoria local' : 'Adaptador HTTP PUT /groceries/sync'}`
            : 'No hay plan semanal activo en este momento'
        }
        action={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate('meal-plan')}
              className="px-3 py-2 rounded-lg border border-border bg-surface hover:bg-surface-alt text-xs font-medium text-ink cursor-pointer"
            >
              Ver menú semanal
            </button>
            <button
              type="button"
              disabled={syncing || !activePlan}
              onClick={() => void handleSync()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              <span>Sincronizar desde Plan</span>
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <div className="rounded-lg border border-border bg-surface-alt/50 p-2.5">
            <span className="text-ink-muted block">Nuevos del plan</span>
            <strong className="font-mono text-base text-ink">{previewDiff.addedCount}</strong>
          </div>
          <div className="rounded-lg border border-border bg-surface-alt/50 p-2.5">
            <span className="text-ink-muted block">Actualizados</span>
            <strong className="font-mono text-base text-ink">{previewDiff.updatedCount}</strong>
          </div>
          <div className="rounded-lg border border-border bg-surface-alt/50 p-2.5">
            <span className="text-ink-muted block">Comprados intactos</span>
            <strong className="font-mono text-base text-brand">{previewDiff.preservedBoughtCount}</strong>
          </div>
          <div className="rounded-lg border border-border bg-surface-alt/50 p-2.5">
            <span className="text-ink-muted block">Manuales intactos</span>
            <strong className="font-mono text-base text-ink">{previewDiff.preservedManualCount}</strong>
          </div>
          <div className="rounded-lg border border-border bg-surface-alt/50 p-2.5">
            <span className="text-ink-muted block">Retirados</span>
            <strong className="font-mono text-base text-ink-muted">{previewDiff.retiredCount}</strong>
          </div>
        </div>

        {lastSyncDiff && (
          <InlineAlert tone="success" title="Sincronización aplicada sin duplicados">
            Se procesaron {lastSyncDiff.items.length} artículos en {lastSyncDiff.estimatedBatchCalls} lote(s) (límite físico ≤ 25 ítems/lote).{' '}
            {isLocalDevMock
              ? 'Estado actualizado únicamente en memoria RAM (mock local).'
              : 'Lotes enviados mediante adaptador HTTP.'}
          </InlineAlert>
        )}
      </SectionCard>

      {/* Manual Item + Grocery Directory */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <SectionCard
          className="lg:col-span-4"
          title="Añadir Artículo Manual"
          subtitle="Los artículos manuales nunca se sobrescriben al sincronizar el menú"
        >
          <form onSubmit={e => void handleAddManual(e)} className="space-y-3">
            <div className="space-y-1">
              <label htmlFor="groc-name" className="text-xs font-medium text-ink-muted">
                Nombre del artículo
              </label>
              <input
                id="groc-name"
                type="text"
                required
                placeholder="Ej. Café en grano, Sal marina"
                value={manualName}
                onChange={e => setManualName(e.target.value)}
                className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label htmlFor="groc-qty" className="text-xs font-medium text-ink-muted">
                  Cantidad
                </label>
                <input
                  id="groc-qty"
                  type="number"
                  step="0.1"
                  min={0.1}
                  value={manualQty}
                  onChange={e => setManualQty(Math.max(0.1, Number(e.target.value) || 0.1))}
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink font-mono"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="groc-unit" className="text-xs font-medium text-ink-muted">
                  Unidad
                </label>
                <input
                  id="groc-unit"
                  type="text"
                  value={manualUnit}
                  onChange={e => setManualUnit(e.target.value)}
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="groc-dept" className="text-xs font-medium text-ink-muted">
                Pasillo / Categoría
              </label>
              <select
                id="groc-dept"
                value={manualDept}
                onChange={e => setManualDept(e.target.value as GroceryDepartment)}
                className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
              >
                <option value="carnes">Carnes y Pescados</option>
                <option value="huevos">Huevos y Lácteos</option>
                <option value="verduras">Verduras y Frutas</option>
                <option value="carbohidratos">Granos y Carbohidratos</option>
                <option value="grasas">Grasas y Frutos Secos</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={!manualName.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-sm font-medium cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Añadir a Lista</span>
            </button>
          </form>
        </SectionCard>

        <SectionCard
          className="lg:col-span-8"
          title="Lista de Compras"
          subtitle="Marca los productos adquiridos en el supermercado"
          action={
            <select
              aria-label="Filtrar por pasillo"
              value={deptFilter}
              onChange={e => setDeptFilter(e.target.value as GroceryDepartment | 'all')}
              className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink"
            >
              {Object.entries(DEPARTMENT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          }
        >
          {filteredGroceries.length === 0 ? (
            <StatePanel
              mode="empty"
              title="Lista de compras vacía"
              description="Sincroniza desde tu menú semanal o añade artículos manualmente."
              actionLabel={activePlan ? 'Sincronizar ahora' : undefined}
              onAction={activePlan ? () => void handleSync() : undefined}
            />
          ) : (
            <div className="divide-y divide-border">
              {filteredGroceries.map(item => {
                const isBought = item.status === 'bought';
                return (
                  <div key={item.id} className="py-2.5 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => void toggleGrocery(item.id)}
                      className="flex items-center gap-3 text-left flex-1 min-w-0 cursor-pointer"
                    >
                      {isBought ? (
                        <CheckSquare className="w-4 h-4 text-brand shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-ink-muted shrink-0" />
                      )}
                      <div className="min-w-0">
                        <div className={`text-sm font-medium truncate ${isBought ? 'line-through text-ink-muted' : 'text-ink'}`}>
                          {item.name}
                        </div>
                        <div className="text-xs text-ink-muted flex flex-wrap gap-2">
                          <span>{DEPARTMENT_LABELS[item.department]}</span>
                          <span>·</span>
                          <span>{item.origin === 'manual' ? 'Manual' : item.recipeSource || 'Plan semanal'}</span>
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-mono tabular-nums font-semibold text-ink bg-surface-alt border border-border rounded px-2 py-1">
                        {item.quantity} {item.unit}
                      </span>
                      <button
                        type="button"
                        onClick={() => void deleteGrocery(item.id)}
                        aria-label={`Eliminar ${item.name}`}
                        className="p-1.5 text-ink-muted hover:text-danger cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};
