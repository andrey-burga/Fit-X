import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { formatSpanishDate, getTodayLocalDateString, getLocalDateString } from '../../services/dateUtils';
import { UserAvatar } from './UserAvatar';
import { formatUserRoleLabel, PRIVATE_ROUTE_META } from '../../utils/roleDisplay';

interface HeaderProps {
  onOpenSearch: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenSearch }) => {
  const {
    currentPath,
    openMealDrawer,
    navigate,
    toggleMobileSidebar,
    showToast,
    currentUser,
    isAuthenticated,
    openAuthModal,
    openNotificationPanel,
    unreadNotificationCount,
    selectedDate,
    setSelectedDate,
    selectedDateFormatted,
    mealLogs,
  } = useApp();

  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);

  const activeRouteMeta = PRIVATE_ROUTE_META[currentPath] || {
    title: 'VigorCore',
    section: 'Nutrición',
  };

  // Compute available quick dates from today, yesterday, and unique meal log dates
  const availableQuickDates = useMemo(() => {
    const todayStr = getTodayLocalDateString();
    const yesterdayObj = new Date();
    yesterdayObj.setDate(yesterdayObj.getDate() - 1);
    const yesterdayStr = `${yesterdayObj.getFullYear()}-${String(yesterdayObj.getMonth() + 1).padStart(2, '0')}-${String(yesterdayObj.getDate()).padStart(2, '0')}`;

    const setDates = new Set<string>();
    setDates.add(todayStr);
    setDates.add(yesterdayStr);

    mealLogs.forEach(item => {
      const d = getLocalDateString(item.dateTime);
      if (d) setDates.add(d);
    });

    return Array.from(setDates).sort().reverse();
  }, [mealLogs]);

  const handleDateSelect = (dateStr: string) => {
    setSelectedDate(dateStr);
    setIsDatePickerOpen(false);
    showToast(`Mostrando registros para: ${formatSpanishDate(dateStr)}`);
  };

  // Listen to Cmd+K or Ctrl+K to open search modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        onOpenSearch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenSearch]);

  return (
    <header className="fixed top-0 left-0 lg:left-72 right-0 h-16 bg-surface-container-lowest/95 backdrop-blur-xl z-40 flex items-center justify-between gap-2 px-3 sm:px-5 border-b border-surface-container/60">
      <div className="flex items-center gap-2 xl:gap-3 min-w-0">
        {/* Mobile Hamburger */}
        <button
          onClick={toggleMobileSidebar}
          className="lg:hidden p-2 rounded-lg text-on-surface-variant hover:bg-surface-container-low transition-colors cursor-pointer shrink-0"
          aria-label="Abrir menú de navegación"
          title="Abrir menú de navegación"
          type="button"
        >
          <span className="material-symbols-outlined text-2xl">menu</span>
        </button>

        {/* Active Section & View Context */}
        <div className="hidden md:flex items-center gap-1.5 text-xs shrink-0 whitespace-nowrap">
          <span className="hidden xl:inline text-on-surface-variant font-medium">
            {activeRouteMeta.section}
          </span>
          <span aria-hidden="true" className="hidden xl:inline text-outline-variant">/</span>
          <span className="font-semibold text-on-surface truncate max-w-[165px] xl:max-w-[200px]">
            {activeRouteMeta.title}
          </span>
        </div>

        {/* Global Search Trigger Bar */}
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex items-center gap-1.5 bg-surface-container-low hover:bg-surface-container px-2.5 py-1.5 rounded-xl border border-surface-container/60 text-on-surface-variant transition-colors cursor-pointer text-xs whitespace-nowrap shrink-0"
          title="Buscar comidas, ejercicios o módulos (Ctrl+K o ⌘K)"
        >
          <span className="material-symbols-outlined text-base text-primary">search</span>
          <span className="hidden 2xl:inline font-normal">Buscar comidas, ejercicios...</span>
          <span className="hidden md:inline 2xl:hidden font-normal">Buscar</span>
          <span className="hidden 2xl:inline-flex items-center px-1.5 py-0.5 rounded bg-surface-container text-[10px] font-mono font-medium text-on-surface-variant border border-surface-container-high ml-0.5">
            ⌘K
          </span>
        </button>

        {/* Date Selector */}
        <div className="relative hidden xl:block shrink-0">
          <button
            onClick={() => setIsDatePickerOpen(prev => !prev)}
            className="flex items-center gap-1.5 bg-surface-container-low hover:bg-surface-container px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer border border-surface-container/50 whitespace-nowrap"
            type="button"
            aria-expanded={isDatePickerOpen}
            aria-label="Seleccionar fecha de registro"
          >
            <span className="material-symbols-outlined text-sm text-on-surface-variant">event</span>
            <span className="font-label-md text-label-md text-on-surface font-medium whitespace-nowrap">
              {selectedDateFormatted}
            </span>
            <span className="material-symbols-outlined text-sm text-on-surface-variant">expand_more</span>
          </button>

          {isDatePickerOpen && (
            <div className="absolute left-0 mt-1.5 w-64 bg-surface-container-lowest rounded-xl shadow-xl border border-surface-container p-2 z-50 flex flex-col gap-1.5">
              <div className="px-1 text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider flex items-center justify-between">
                <span>Fecha de registro</span>
                <span className="text-[10px] font-mono text-primary font-normal">{selectedDate}</span>
              </div>

              <div className="px-1 py-1">
                <label htmlFor="header-date-input" className="text-[10px] text-on-surface-variant block mb-1">
                  Elegir fecha:
                </label>
                <input
                  id="header-date-input"
                  type="date"
                  value={selectedDate}
                  onChange={e => {
                    if (e.target.value) handleDateSelect(e.target.value);
                  }}
                  className="w-full bg-surface-container-low border border-surface-container px-2 py-1 rounded text-xs font-mono text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="border-t border-surface-container/60 my-0.5" />

              <div className="px-1 text-[10px] text-on-surface-variant">Fechas recientes con registro:</div>
              <div className="max-h-48 overflow-y-auto flex flex-col gap-0.5">
                {availableQuickDates.map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleDateSelect(d)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      selectedDate === d
                        ? 'bg-primary text-on-primary font-semibold shadow-xs'
                        : 'text-on-surface hover:bg-surface-container-low'
                    }`}
                  >
                    {formatSpanishDate(d)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Quick Meal button */}
        <button
          onClick={openMealDrawer}
          className="flex items-center gap-1.5 px-2.5 lg:px-3 py-1.5 bg-surface-container-low hover:bg-surface-container text-on-surface font-label-md text-label-md rounded-lg font-medium transition-colors border border-surface-container/60 whitespace-nowrap shrink-0 cursor-pointer"
          type="button"
        >
          <span className="material-symbols-outlined text-base text-primary">add</span>
          <span className="hidden lg:inline">Registrar comida</span>
          <span className="lg:hidden text-xs">Comida</span>
        </button>

        {/* Quick Workout button */}
        <button
          onClick={() => navigate('registro-de-entrenamiento')}
          className="flex items-center gap-1.5 px-2.5 lg:px-3 py-1.5 bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md rounded-lg font-medium transition-colors shadow-xs whitespace-nowrap shrink-0 cursor-pointer"
          type="button"
        >
          <span className="material-symbols-outlined text-base">add</span>
          <span className="hidden lg:inline">Registrar entreno</span>
          <span className="lg:hidden text-xs">Entreno</span>
        </button>

        <div className="h-5 w-[1px] bg-outline-variant/40 mx-0.5 hidden sm:block" />

        {/* Notification Bell with counter */}
        <button
          onClick={openNotificationPanel}
          className="relative p-2 rounded-xl text-on-surface-variant hover:bg-surface-container-low hover:text-on-surface transition-colors cursor-pointer"
          aria-label={unreadNotificationCount > 0 ? `Notificaciones (${unreadNotificationCount} sin leer)` : 'Notificaciones'}
          title="Notificaciones y alertas"
          type="button"
        >
          <span className="material-symbols-outlined text-xl">notifications</span>
          {unreadNotificationCount > 0 && (
            <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-primary text-on-primary rounded-full text-[10px] font-bold flex items-center justify-center ring-2 ring-surface-container-lowest tabular-nums">
              {unreadNotificationCount}
            </span>
          )}
        </button>

        {/* User Auth Profile Trigger */}
        <button
          type="button"
          onClick={() => {
            if (isAuthenticated) {
              navigate('perfil-atleta');
            } else {
              openAuthModal();
            }
          }}
          className="flex items-center gap-2 p-1 pl-1.5 pr-2 rounded-xl bg-surface-container-low/80 hover:bg-surface-container cursor-pointer transition-colors border border-surface-container/60"
          title={isAuthenticated ? `Perfil de ${currentUser?.name}` : 'Iniciar sesión'}
        >
          {isAuthenticated && currentUser ? (
            <>
              <UserAvatar
                name={currentUser.name}
                avatarUrl={currentUser.avatarUrl}
                sizeClassName="w-7 h-7"
              />
              <div className="hidden lg:flex flex-col text-left">
                <span className="text-xs font-semibold text-on-surface leading-tight truncate max-w-[100px]">
                  {currentUser.name}
                </span>
                <span className="text-[10px] text-primary font-medium leading-none">
                  {formatUserRoleLabel(currentUser.role)}
                </span>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-1.5 px-1 py-0.5">
              <span className="material-symbols-outlined text-base text-primary">account_circle</span>
              <span className="text-xs font-semibold text-primary hidden sm:inline">Acceder</span>
            </div>
          )}
        </button>
      </div>
    </header>
  );
};
