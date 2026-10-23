import React, { useState, useEffect } from 'react';
import { useApp } from '../../context/AppContext';

export const NotificationPreferencesModal: React.FC = () => {
  const {
    notificationPreferences,
    updateNotificationPreferences,
    requestPushPermission,
    sendPushAlert,
    isPreferencesModalOpen,
    closePreferencesModal,
    showToast,
  } = useApp();

  const [prefs, setPrefs] = useState({ ...notificationPreferences });
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);

  useEffect(() => {
    setPrefs({ ...notificationPreferences });
  }, [notificationPreferences, isPreferencesModalOpen]);

  if (!isPreferencesModalOpen) return null;

  const handleToggle = (key: keyof typeof prefs) => {
    setPrefs(prev => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleEnablePush = async () => {
    setIsRequestingPermission(true);
    const granted = await requestPushPermission();
    setIsRequestingPermission(false);
    if (granted) {
      setPrefs(prev => ({ ...prev, pushEnabled: true, pushPermission: 'granted' }));
      showToast('Permiso de notificaciones push del navegador concedido', 'success');
      sendPushAlert('Notificaciones Activas', 'Recibirás avisos críticos incluso si la pestaña está en segundo plano.', 'sistema');
    } else {
      setPrefs(prev => ({ ...prev, pushEnabled: false, pushPermission: 'denied' }));
      showToast('El navegador denegó el permiso para notificaciones web', 'warning');
    }
  };

  const handleSave = () => {
    updateNotificationPreferences(prefs);
    showToast('Preferencias de notificación guardadas');
    closePreferencesModal();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-inverse-surface/40 backdrop-blur-xs transition-opacity"
        onClick={closePreferencesModal}
      />

      {/* Modal Content */}
      <div className="relative w-full max-w-lg bg-surface-container-lowest rounded-2xl shadow-2xl border border-surface-container overflow-hidden z-10 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-space-lg pb-space-md border-b border-surface-container/40 flex items-center justify-between">
          <div className="flex items-center gap-space-sm">
            <div className="w-10 h-10 rounded-xl bg-primary-container text-on-primary-container flex items-center justify-center">
              <span className="material-symbols-outlined text-2xl">notifications_active</span>
            </div>
            <div>
              <h3 className="font-headline-sm text-base font-bold text-on-surface">
                Preferencias de Notificación
              </h3>
              <p className="text-xs text-on-surface-variant">
                Controla las alertas automáticas de telemetría y sincronización
              </p>
            </div>
          </div>
          <button
            onClick={closePreferencesModal}
            className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
            title="Cerrar"
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-space-lg space-y-space-md overflow-y-auto">
          {/* Master Push Banner */}
          <div className="p-space-md bg-surface-container-low rounded-xl border border-surface-container flex flex-col gap-space-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-space-xs">
                <span className="material-symbols-outlined text-primary text-xl">devices</span>
                <div>
                  <h4 className="text-xs font-bold text-on-surface">Notificaciones Push del Navegador</h4>
                  <p className="text-[11px] text-on-surface-variant">
                    Estado en el sistema: <span className="font-semibold uppercase">{prefs.pushPermission}</span>
                  </p>
                </div>
              </div>

              {prefs.pushPermission === 'granted' ? (
                <span className="px-2.5 py-1 bg-primary text-on-primary rounded-full text-xs font-bold flex items-center gap-1">
                  <span className="material-symbols-outlined text-xs">check_circle</span>
                  Habilitado
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleEnablePush}
                  disabled={isRequestingPermission}
                  className="px-3 py-1.5 bg-primary hover:bg-primary-container text-on-primary rounded-lg text-xs font-semibold transition-colors flex items-center gap-1 disabled:opacity-50"
                >
                  <span className="material-symbols-outlined text-xs">notification_add</span>
                  {isRequestingPermission ? 'Solicitando...' : 'Conceder permiso'}
                </button>
              )}
            </div>

            <p className="text-[11px] text-on-surface-variant leading-relaxed">
              Permite a Vigor Core alertarte sobre ventanas anabólicas de comida, temporizadores de descanso de 90s completados en Gym Mode y alertas de compras pendientes.
            </p>
          </div>

          {/* Individual Category Switches */}
          <div className="space-y-3">
            <h5 className="text-xs font-bold text-on-surface uppercase tracking-wider">
              Categorías de Eventos
            </h5>

            {/* Meal reminders */}
            <div className="flex items-center justify-between p-3 bg-surface-container-low/70 rounded-xl border border-surface-container/50">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-primary text-lg">restaurant</span>
                <div>
                  <div className="text-xs font-semibold text-on-surface">Recordatorios de Comidas</div>
                  <div className="text-[11px] text-on-surface-variant">
                    Avisos 15 minutos antes de la hora configurada (Almuerzo, Merienda, Cena)
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggle('mealReminders')}
                className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${
                  prefs.mealReminders ? 'bg-primary' : 'bg-surface-container-high'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    prefs.mealReminders ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Workout alerts */}
            <div className="flex items-center justify-between p-3 bg-surface-container-low/70 rounded-xl border border-surface-container/50">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-primary text-lg">fitness_center</span>
                <div>
                  <div className="text-xs font-semibold text-on-surface">Alertas de Entrenamiento</div>
                  <div className="text-[11px] text-on-surface-variant">
                    Nuevos récords 1RM, fin de temporizador de descanso y microciclos
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggle('workoutAlerts')}
                className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${
                  prefs.workoutAlerts ? 'bg-primary' : 'bg-surface-container-high'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    prefs.workoutAlerts ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Grocery alerts */}
            <div className="flex items-center justify-between p-3 bg-surface-container-low/70 rounded-xl border border-surface-container/50">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-primary text-lg">shopping_cart</span>
                <div>
                  <div className="text-xs font-semibold text-on-surface">Insumos y Lista de Compras</div>
                  <div className="text-[11px] text-on-surface-variant">
                    Artículos pendientes para abastecer el menú de la próxima semana
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggle('groceryAlerts')}
                className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${
                  prefs.groceryAlerts ? 'bg-primary' : 'bg-surface-container-high'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    prefs.groceryAlerts ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* System sync */}
            <div className="flex items-center justify-between p-3 bg-surface-container-low/70 rounded-xl border border-surface-container/50">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-primary text-lg">sync_saved_locally</span>
                <div>
                  <div className="text-xs font-semibold text-on-surface">Sincronización de Base de Datos</div>
                  <div className="text-[11px] text-on-surface-variant">
                    Alertas de sincronización con Supabase y respaldo de cambios
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggle('systemSync')}
                className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${
                  prefs.systemSync ? 'bg-primary' : 'bg-surface-container-high'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    prefs.systemSync ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Sounds */}
            <div className="flex items-center justify-between p-3 bg-surface-container-low/70 rounded-xl border border-surface-container/50">
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-primary text-lg">volume_up</span>
                <div>
                  <div className="text-xs font-semibold text-on-surface">Efectos de Sonido</div>
                  <div className="text-[11px] text-on-surface-variant">
                    Retroalimentación acústica al completar series y registrar alimentos
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleToggle('soundEnabled')}
                className={`w-11 h-6 rounded-full transition-colors relative p-0.5 ${
                  prefs.soundEnabled ? 'bg-primary' : 'bg-surface-container-high'
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    prefs.soundEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-space-md border-t border-surface-container/40 bg-surface-container-low flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              sendPushAlert('Prueba de Sistema', 'Tu configuración de notificaciones funciona a la perfección.', 'sistema');
              showToast('Alerta de prueba enviada');
            }}
            className="text-xs font-semibold text-primary hover:underline flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-sm">send</span>
            Enviar alerta de prueba
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={closePreferencesModal}
              className="px-3 py-1.5 text-xs text-on-surface-variant hover:text-on-surface font-medium"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 bg-primary hover:bg-primary-container text-on-primary rounded-xl text-xs font-semibold transition-colors shadow-xs"
            >
              Guardar Cambios
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
