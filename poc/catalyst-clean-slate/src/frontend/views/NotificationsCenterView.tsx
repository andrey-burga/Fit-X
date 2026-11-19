/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Dedicated Notifications Center & Preferences View
 * Promotes root modal-only notifications into a full Clean-Slate route.
 */

import React, { useMemo, useState } from 'react';
import { Bell, CheckCheck, Plus } from 'lucide-react';
import type { NotificationCategory } from '../contracts/cleanSlateModels';
import { useWorkspace } from '../state/WorkspaceContext';
import { SectionCard, StatTile, StatePanel } from '../components/UiPrimitives';

const CATEGORY_LABELS: Record<NotificationCategory | 'all', string> = {
  all: 'Todas',
  nutricion: 'Nutrición',
  entrenamiento: 'Entrenamiento',
  compras: 'Compras',
  sistema: 'Sistema',
};

export const NotificationsCenterView: React.FC = () => {
  const {
    workspace,
    unreadNotificationsCount,
    markNotificationRead,
    markAllNotificationsRead,
    createNotification,
    savePreferences,
    navigate,
  } = useWorkspace();

  const [categoryFilter, setCategoryFilter] = useState<NotificationCategory | 'all'>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<NotificationCategory>('nutricion');

  const notifications = workspace?.notifications ?? [];
  const prefs = workspace?.preferences;

  const filtered = useMemo(() => {
    return notifications.filter(n => {
      if (categoryFilter !== 'all' && n.category !== categoryFilter) return false;
      if (unreadOnly && n.read) return false;
      return true;
    });
  }, [notifications, categoryFilter, unreadOnly]);

  if (!workspace) return null;

  const handleCreateReminder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) return;
    await createNotification({
      title: title.trim(),
      message: message.trim(),
      category,
      severity: 'info',
      actionView: category === 'compras' ? 'shopping-list' : category === 'entrenamiento' ? 'live-workout' : 'nutrition-log',
    });
    setTitle('');
    setMessage('');
  };

  const handleTogglePref = async (
    key: keyof NonNullable<typeof prefs>['notificationPreferences']
  ) => {
    if (!prefs) return;
    await savePreferences({
      ...prefs,
      notificationPreferences: {
        ...prefs.notificationPreferences,
        [key]: !prefs.notificationPreferences[key],
      },
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Total Bandeja" value={notifications.length} detail="Modelo contractual NOTIFICATION" />
        <StatTile
          label="Sin Leer"
          value={unreadNotificationsCount}
          tone={unreadNotificationsCount > 0 ? 'warn' : 'brand'}
          detail="Requieren atención"
        />
        <StatTile
          label="Leídas"
          value={notifications.length - unreadNotificationsCount}
          detail="Historial revisado"
        />
          <StatTile
          label="Canales Activos"
          value={
            prefs
              ? Object.values(prefs.notificationPreferences).filter(Boolean).length
              : 0
          }
          tone="info"
          detail="Estado en repositorio activo"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-4 space-y-5">
          <SectionCard
            title="Preferencias de Alertas"
            subtitle="Sincronizadas vía PUT /api/v1/athlete/preferences y PATCH /api/v1/athlete/notifications/:notificationId/read"
          >
            {!prefs ? (
              <StatePanel
                mode="empty"
                title="Preferencias no inicializadas"
                description="Completa el onboarding en Perfil y Biometría."
              />
            ) : (
              <div className="space-y-3 text-sm">
                {(
                  [
                    { key: 'mealReminders', label: 'Recordatorios de comidas y macros' },
                    { key: 'workoutAlerts', label: 'Alertas de sesiones y mesociclo' },
                    { key: 'groceryAlerts', label: 'Actualizaciones de lista de compras' },
                    { key: 'systemUpdates', label: 'Avisos de sistema y gobierno' },
                  ] as const
                ).map(item => (
                  <label
                    key={item.key}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-alt/40 px-3 py-2.5 cursor-pointer"
                  >
                    <span className="text-xs font-medium text-ink">{item.label}</span>
                    <input
                      type="checkbox"
                      checked={prefs.notificationPreferences[item.key]}
                      onChange={() => void handleTogglePref(item.key)}
                    />
                  </label>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="Crear Recordatorio Local"
            subtitle="Prueba la creación de alertas dentro de la partición del atleta"
          >
            <form onSubmit={e => void handleCreateReminder(e)} className="space-y-3">
              <div className="space-y-1">
                <label htmlFor="notif-cat" className="text-xs font-medium text-ink-muted">
                  Categoría
                </label>
                <select
                  id="notif-cat"
                  value={category}
                  onChange={e => setCategory(e.target.value as NotificationCategory)}
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink"
                >
                  <option value="nutricion">Nutrición</option>
                  <option value="entrenamiento">Entrenamiento</option>
                  <option value="compras">Compras</option>
                  <option value="sistema">Sistema</option>
                </select>
              </div>
              <input
                aria-label="Título de notificación"
                type="text"
                required
                placeholder="Título del recordatorio"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink"
              />
              <textarea
                aria-label="Mensaje de notificación"
                rows={2}
                required
                placeholder="Detalle del recordatorio..."
                value={message}
                onChange={e => setMessage(e.target.value)}
                className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink"
              />
              <button
                type="submit"
                disabled={!title.trim() || !message.trim()}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-xs font-medium cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Generar Notificación</span>
              </button>
            </form>
          </SectionCard>
        </div>

        <SectionCard
          className="lg:col-span-8"
          title={`Centro de Notificaciones (${filtered.length})`}
          subtitle="Filtros por categoría y estado de lectura"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filtrar categoría notificación"
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value as typeof categoryFilter)}
                className="rounded-lg border border-border bg-canvas px-2.5 py-1.5 text-xs text-ink"
              >
                {Object.entries(CATEGORY_LABELS).map(([k, lbl]) => (
                  <option key={k} value={k}>
                    {lbl}
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-1.5 text-xs text-ink cursor-pointer px-2">
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={e => setUnreadOnly(e.target.checked)}
                />
                <span>Solo sin leer</span>
              </label>
              <button
                type="button"
                disabled={unreadNotificationsCount === 0}
                onClick={() => void markAllNotificationsRead()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-alt disabled:opacity-50 text-xs font-medium text-ink cursor-pointer"
              >
                <CheckCheck className="w-3.5 h-3.5 text-brand" />
                <span>Marcar todas leídas</span>
              </button>
            </div>
          }
        >
          {filtered.length === 0 ? (
            <StatePanel
              mode="empty"
              title="Sin notificaciones en esta vista"
              description="No hay alertas que coincidan con el filtro seleccionado."
            />
          ) : (
            <div className="space-y-2.5">
              {filtered.map(n => (
                <div
                  key={n.id}
                  className={`rounded-xl border p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    n.read ? 'border-border bg-surface' : 'border-brand/30 bg-brand-soft/30'
                  }`}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Bell className={`w-3.5 h-3.5 shrink-0 ${n.read ? 'text-ink-muted' : 'text-brand'}`} />
                      <span className="text-sm font-semibold text-ink">{n.title}</span>
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-surface-alt border border-border text-ink-muted capitalize">
                        {n.category}
                      </span>
                    </div>
                    <p className="text-xs text-ink-muted">{n.message}</p>
                    <div className="text-[11px] font-mono text-ink-muted">{n.createdAt.slice(0, 16).replace('T', ' ')}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {n.actionView && (
                      <button
                        type="button"
                        onClick={() => navigate(n.actionView!)}
                        className="px-2.5 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-alt text-xs text-ink cursor-pointer"
                      >
                        Abrir vista
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void markNotificationRead(n.id, !n.read)}
                      className="px-2.5 py-1.5 rounded-lg bg-surface-alt hover:bg-canvas border border-border text-xs text-ink cursor-pointer"
                    >
                      {n.read ? 'Marcar no leída' : 'Marcar leída'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};
