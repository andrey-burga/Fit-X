/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/layout/Sidebar';
import { Header } from './components/layout/Header';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { LoginView } from './views/LoginView';

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
  const { currentPath, authStatus, isAuthenticated } = useApp();
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // 1. Initializing state: ProtectedRoute displays the secure branded loader (Zero data leakage)
  if (authStatus === 'initializing') {
    return (
      <ProtectedRoute>
        <div />
      </ProtectedRoute>
    );
  }

  // 2. Fatal Auth Error or Failed Logout Lockdown: ProtectedRoute displays lockdown error UI
  if (authStatus === 'error') {
    return (
      <ProtectedRoute>
        <div />
      </ProtectedRoute>
    );
  }

  // 2. Unauthenticated: Full private layout is stripped; dedicated LoginView rendered
  if (
    authStatus === 'unauthenticated' ||
    !isAuthenticated ||
    currentPath === 'login' ||
    currentPath === 'registro' ||
    currentPath === 'recuperar-password'
  ) {
    return (
      <div className="min-h-screen bg-surface text-on-surface antialiased font-body-md selection:bg-primary-fixed selection:text-on-primary-fixed">
        <LoginView />
        <ToastNotification />
      </div>
    );
  }

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

  // 3. Authenticated: Render full private shell
  return (
    <ProtectedRoute>
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
    </ProtectedRoute>
  );
};

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}
