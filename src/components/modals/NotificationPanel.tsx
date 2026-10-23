import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { NotificationCategory, AppNotification } from '../../types/auth';
import { NavigationPath } from '../../types';

export const NotificationPanel: React.FC = () => {
  const {
    notifications,
    unreadNotificationCount,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    deleteNotification,
    isNotificationPanelOpen,
    closeNotificationPanel,
    openPreferencesModal,
    navigate,
    sendPushAlert,
    showToast,
  } = useApp();

  const [activeTab, setActiveTab] = useState<'all' | NotificationCategory>('all');

  if (!isNotificationPanelOpen) return null;

  const filteredNotifications = notifications.filter(n => {
    if (activeTab === 'all') return true;
    return n.category === activeTab;
  });

  const handleNotificationClick = (item: AppNotification) => {
    markNotificationAsRead(item.id);
    if (item.actionPath) {
      navigate(item.actionPath as NavigationPath);
      closeNotificationPanel();
      showToast(`Navegando a: ${item.title}`);
    }
  };

  const getCategoryIcon = (category: NotificationCategory) => {
    switch (category) {
      case 'nutricion':
        return 'restaurant';
      case 'entrenamiento':
        return 'fitness_center';
      case 'compras':
        return 'shopping_cart';
      case 'sistema':
      default:
        return 'notifications';
    }
  };

  const getSeverityBadge = (severity?: 'info' | 'success' | 'warning') => {
    switch (severity) {
      case 'success':
        return 'bg-primary-fixed text-on-primary-fixed';
      case 'warning':
        return 'bg-amber-100 text-amber-800';
      case 'info':
      default:
        return 'bg-surface-container-high text-on-surface-variant';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end sm:p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-inverse-surface/30 backdrop-blur-xs transition-opacity"
        onClick={closeNotificationPanel}
      />

      {/* Slide-in / Popup container */}
      <div className="relative w-full max-w-md h-full sm:h-auto sm:max-h-[85vh] bg-surface-container-lowest rounded-none sm:rounded-2xl shadow-2xl border border-surface-container z-10 flex flex-col overflow-hidden sm:mt-16 sm:mr-4">
        {/* Header */}
        <div className="p-space-md border-b border-surface-container/40 flex items-center justify-between bg-surface-container-lowest">
          <div className="flex items-center gap-space-xs">
            <span className="material-symbols-outlined text-primary text-xl">notifications</span>
            <span className="font-headline-sm text-base font-bold text-on-surface">
              Centro de Notificaciones
            </span>
            {unreadNotificationCount > 0 && (
              <span className="bg-primary text-on-primary text-[11px] font-bold px-2 py-0.5 rounded-full shadow-xs">
                {unreadNotificationCount} nuevas
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                closeNotificationPanel();
                openPreferencesModal();
              }}
              className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
              title="Preferencias de notificación"
              type="button"
            >
              <span className="material-symbols-outlined text-lg">tune</span>
            </button>
            <button
              onClick={closeNotificationPanel}
              className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
              title="Cerrar panel"
              type="button"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>

        {/* Categories Tab Bar */}
        <div className="px-space-md pt-2 pb-1 flex gap-1 border-b border-surface-container/30 overflow-x-auto no-scrollbar">
          {[
            { id: 'all', label: 'Todas' },
            { id: 'nutricion', label: 'Nutrición' },
            { id: 'entrenamiento', label: 'Entreno' },
            { id: 'compras', label: 'Compras' },
            { id: 'sistema', label: 'Sistema' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-primary text-on-primary font-semibold'
                  : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto divide-y divide-surface-container/30 p-2">
          {filteredNotifications.length === 0 ? (
            <div className="py-12 px-4 text-center flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-on-surface-variant mb-2">
                <span className="material-symbols-outlined text-2xl">notifications_off</span>
              </div>
              <p className="text-sm font-semibold text-on-surface">No hay alertas en esta categoría</p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Los recordatorios de comidas y récords aparecerán aquí en tiempo real.
              </p>
            </div>
          ) : (
            filteredNotifications.map(item => (
              <div
                key={item.id}
                onClick={() => handleNotificationClick(item)}
                className={`p-3 rounded-xl transition-all cursor-pointer flex gap-3 group relative ${
                  item.read
                    ? 'hover:bg-surface-container-low/70 opacity-80'
                    : 'bg-surface-container-low/90 hover:bg-surface-container border-l-4 border-l-primary'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    item.read
                      ? 'bg-surface-container text-on-surface-variant'
                      : 'bg-primary-container text-on-primary-container'
                  }`}
                >
                  <span className="material-symbols-outlined text-lg">
                    {getCategoryIcon(item.category)}
                  </span>
                </div>

                <div className="flex-1 min-w-0 pr-6">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded font-semibold uppercase tracking-wider ${getSeverityBadge(
                        item.severity
                      )}`}
                    >
                      {item.category}
                    </span>
                    <span className="text-[11px] text-on-surface-variant">{item.timestamp}</span>
                    {!item.read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                    )}
                  </div>
                  <h4 className="text-xs font-semibold text-on-surface truncate">{item.title}</h4>
                  <p className="text-[12px] text-on-surface-variant line-clamp-2 mt-0.5 leading-snug">
                    {item.message}
                  </p>
                </div>

                {/* Delete button */}
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    deleteNotification(item.id);
                  }}
                  className="absolute right-2 top-2 p-1 text-on-surface-variant/40 hover:text-error hover:bg-error-container/20 rounded transition-colors opacity-0 group-hover:opacity-100"
                  title="Eliminar notificación"
                >
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer actions */}
        <div className="p-3 border-t border-surface-container/40 bg-surface-container-low flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={markAllNotificationsAsRead}
            disabled={unreadNotificationCount === 0}
            className="text-xs text-primary font-semibold hover:underline disabled:opacity-40 disabled:no-underline flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-sm">done_all</span>
            Marcar todas leídas
          </button>

          <button
            type="button"
            onClick={() => {
              sendPushAlert(
                'Alerta de Hidratación y Recuperación',
                'Has alcanzado 2.8L de agua. Momento óptimo para 40g de carbohidratos peri-entreno.',
                'nutricion'
              );
            }}
            className="px-2.5 py-1 bg-surface-container hover:bg-surface-container-high text-on-surface text-xs rounded-lg font-medium transition-colors flex items-center gap-1"
            title="Generar notificación de prueba"
          >
            <span className="material-symbols-outlined text-xs text-primary">add_alert</span>
            Alerta de prueba
          </button>
        </div>
      </div>
    </div>
  );
};
