/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';

// Views
import { NutritionalDashboardView } from './views/NutritionalDashboardView';
import { NutritionalConfigView } from './views/NutritionalConfigView';
import { WeeklyMenuView } from './views/WeeklyMenuView';
import { MealLogView } from './views/MealLogView';
import { DailyLogView } from './views/DailyLogView';
import { ShoppingListView } from './views/ShoppingListView';
import { SubstitutionsView } from './views/SubstitutionsView';
import { GuideSettingsView } from './views/GuideSettingsView';
import { WorkoutRoutineView } from './views/WorkoutRoutineView';
import { WorkoutLogView } from './views/WorkoutLogView';
import { CardioHiitView } from './views/CardioHiitView';
import { TrainingProgressView } from './views/TrainingProgressView';

// Modals
import { RegisterMealDrawer } from './components/modals/RegisterMealDrawer';
import { ToastNotification } from './components/modals/ToastNotification';
import { AuthModal } from './components/modals/AuthModal';
import { NotificationPanel } from './components/modals/NotificationPanel';
import { NotificationPreferencesModal } from './components/modals/NotificationPreferencesModal';
import { GlobalSearchModal } from './components/modals/GlobalSearchModal';
import { RecipeModal } from './components/modals/RecipeModal';
import { AssignRecipeModal } from './components/modals/AssignRecipeModal';

const AppContent: React.FC = () => {
  const { currentPath } = useApp();
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const renderActiveView = () => {
    switch (currentPath) {
      case 'dashboard-nutricional':
        return <NutritionalDashboardView />;
      case 'configuracion-nutricional':
        return <NutritionalConfigView />;
      case 'menu-semanal':
        return <WeeklyMenuView />;
      case 'registro-de-comidas':
        return <MealLogView />;
      case 'registro-diario':
        return <DailyLogView />;
      case 'lista-de-compras':
        return <ShoppingListView />;
      case 'sustituciones':
        return <SubstitutionsView />;
      case 'guia-y-ajustes':
        return <GuideSettingsView />;
      case 'rutina-de-entrenamiento':
        return <WorkoutRoutineView />;
      case 'registro-de-entrenamiento':
        return <WorkoutLogView />;
      case 'cardio-y-hiit':
        return <CardioHiitView />;
      case 'progreso-del-entrenamiento':
        return <TrainingProgressView />;
      default:
        return <NutritionalDashboardView />;
    }
  };

  return (
    <div className="min-h-screen bg-surface flex text-on-surface antialiased font-body-md selection:bg-primary-fixed selection:text-on-primary-fixed">
      {/* Persistent / Mobile Responsive Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-72">
        {/* Top Header */}
        <Header onOpenSearch={() => setIsSearchOpen(true)} />

        {/* View Content with padding for top fixed header */}
        <main className="flex-1 pt-16">
          {renderActiveView()}
        </main>
      </div>

      {/* Global Modals & Drawers */}
      <RegisterMealDrawer />
      <AuthModal />
      <NotificationPanel />
      <NotificationPreferencesModal />
      <GlobalSearchModal isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      <RecipeModal />
      <AssignRecipeModal />
      <ToastNotification />
    </div>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
