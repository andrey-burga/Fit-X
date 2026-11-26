/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Decoupled Workspace State Provider
 * Connects React views solely to typed repository interfaces (Dependency Injection),
 * enabling future replacement of local in-memory mocks with Catalyst Advanced I/O HTTP calls
 * without rewriting UI components.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  BiometricsPayload,
  CardioSessionRecord,
  ExecutedWorkoutRecord,
  GroceryItemRecord,
  MealLogRecord,
  MealPlanRecord,
  NotificationRecord,
  PreferencesPayload,
  RecipeRecord,
  UserAccountModel,
  ViewId,
  WorkoutRoutineRecord,
  WorkoutSetRecord,
} from '../contracts/cleanSlateModels';
import {
  CleanSlateRepositoryError,
  type CleanSlateWorkspaceSnapshot,
  type IAdminGovernanceRepository,
  type IAthleteWorkspaceRepository,
  type MockFaultMode,
  type OnboardingCompletionInput,
} from '../contracts/repositories';
import type { CatalystHostedAuthBridge } from '../adapters/CatalystHostedAuthBridge';
import { getTodayIsoDate } from '../domain/nutritionEngine';
import { InMemoryCleanSlateRepository } from '../mocks/InMemoryCleanSlateRepository';
import {
  buildPathWithPreservedMode,
  navigateBrowserPath,
  type AppRouteId,
} from '../routing/authRouting';

export type DevPersonaKey = 'usr_athlete_01' | 'usr_admin_01' | 'usr_superadmin_01';

export interface ToastNotice {
  id: string;
  message: string;
  tone: 'success' | 'info' | 'error';
}

interface WorkspaceContextValue {
  activeView: ViewId;
  navigate: (view: ViewId) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  activePersonaUid: DevPersonaKey;
  switchDevPersona: (uid: DevPersonaKey) => void;

  loadStatus: 'loading' | 'ready' | 'error';
  loadError: string | null;
  reloadWorkspace: () => Promise<void>;

  faultMode: MockFaultMode;
  setSimulatedFaultMode: (mode: MockFaultMode) => Promise<void>;
  resetMockSeed: () => Promise<void>;

  workspace: CleanSlateWorkspaceSnapshot | null;
  todayMacros: { calories: number; protein: number; carbs: number; fat: number; mealsCount: number };
  unreadNotificationsCount: number;
  activeWorkout: ExecutedWorkoutRecord | null;
  defaultRoutine: WorkoutRoutineRecord | null;

  toast: ToastNotice | null;
  notifyToast: (message: string, tone?: ToastNotice['tone']) => void;
  dismissToast: () => void;

  athleteRepo: IAthleteWorkspaceRepository;
  adminRepo: IAdminGovernanceRepository;
  authRepository?: HttpSessionLifecycleRepository;
  authBridge: CatalystHostedAuthBridge | null;
  currentRoute: AppRouteId;
  navigateToPath: (path: string, options?: { replace?: boolean }) => void;
  navigateToAuthLogin: () => void;
  isLocalDevMock: boolean;
  repositoryModeLabel: string;
  logoutSession: (() => Promise<void>) | null;

  // High-level actions updating both repository and hydrated state
  updateProfile: (patch: Record<string, unknown>) => Promise<void>;
  completeOnboarding: (input: OnboardingCompletionInput) => Promise<void>;
  saveBiometrics: (bio: BiometricsPayload) => Promise<void>;
  savePreferences: (pref: PreferencesPayload) => Promise<void>;
  logMeal: (meal: Omit<MealLogRecord, 'id'>) => Promise<void>;
  deleteMeal: (mealId: string) => Promise<void>;
  saveRecipe: (recipe: RecipeRecord) => Promise<void>;
  deleteRecipe: (recipeId: string) => Promise<void>;
  saveMealPlan: (plan: MealPlanRecord) => Promise<void>;
  syncGroceries: (items: GroceryItemRecord[]) => Promise<{ batchCalls: number }>;
  toggleGrocery: (groceryId: string) => Promise<void>;
  addManualGrocery: (item: Omit<GroceryItemRecord, 'id'>) => Promise<void>;
  deleteGrocery: (groceryId: string) => Promise<void>;
  saveWorkoutRoutine: (routine: WorkoutRoutineRecord) => Promise<void>;
  setDefaultRoutine: (routineId: string) => Promise<void>;
  startWorkout: (input: {
    routineId?: string;
    routineName: string;
    routineDayId?: string;
    routineDayName: string;
    exercisesSnapshot: ExecutedWorkoutRecord['exercisesSnapshot'];
  }) => Promise<ExecutedWorkoutRecord>;
  logWorkoutSet: (
    input: Omit<WorkoutSetRecord, 'id' | 'estimated1RM' | 'completedAt'>
  ) => Promise<void>;
  finishWorkout: (
    workoutId: string,
    finalStatus: 'completed' | 'abandoned',
    summary: { durationSeconds: number; sessionRpe?: number; notes?: string }
  ) => Promise<void>;
  addCardioSession: (session: Omit<CardioSessionRecord, 'id'>) => Promise<void>;
  deleteCardioSession: (cardioId: string) => Promise<void>;
  createNotification: (notif: Omit<NotificationRecord, 'id' | 'createdAt' | 'read'>) => Promise<void>;
  markNotificationRead: (id: string, read?: boolean) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export interface HttpSessionLifecycleRepository {
  getMe(): Promise<{ actor: Record<string, unknown>; csrfToken?: string }>;
  logout(): Promise<{ loggedOut: boolean; revokedSid: string }>;
  redeemInvitation?(inviteId: string, token: string): Promise<{ assignedRole: string; roleVersion: number }>;
}

export interface WorkspaceProviderProps {
  children: React.ReactNode;
  athleteRepository?: IAthleteWorkspaceRepository;
  adminRepository?: IAdminGovernanceRepository;
  authRepository?: HttpSessionLifecycleRepository;
  authBridge?: CatalystHostedAuthBridge | null;
  currentRoute?: AppRouteId;
  onNavigateRoute?: (path: string, options?: { replace?: boolean }) => void;
  initialView?: ViewId;
  initialPersonaUid?: DevPersonaKey;
  initialWorkspaceSnapshot?: CleanSlateWorkspaceSnapshot | null;
  initialLoadStatus?: 'loading' | 'ready' | 'error';
  initialLoadError?: string | null;
}

export const WorkspaceProvider: React.FC<WorkspaceProviderProps> = ({
  children,
  athleteRepository,
  adminRepository,
  authRepository,
  authBridge = null,
  currentRoute = 'workspace',
  onNavigateRoute,
  initialView = 'dashboard',
  initialPersonaUid = 'usr_athlete_01',
  initialWorkspaceSnapshot = null,
  initialLoadStatus,
  initialLoadError = null,
}) => {
  const defaultMockRepo = useMemo(() => new InMemoryCleanSlateRepository({ delayMs: 40 }), []);
  const athleteRepo = athleteRepository ?? defaultMockRepo;
  const adminRepo = adminRepository ?? defaultMockRepo;

  const [activeView, setActiveView] = useState<ViewId>(initialView);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [activePersonaUid, setActivePersonaUid] = useState<DevPersonaKey>(initialPersonaUid);
  const [loadStatus, setLoadStatus] = useState<'loading' | 'ready' | 'error'>(
    initialLoadStatus ?? (initialWorkspaceSnapshot ? 'ready' : 'loading')
  );
  const [loadError, setLoadError] = useState<string | null>(initialLoadError);
  const [faultMode, setFaultMode] = useState<MockFaultMode>('none');
  const [workspace, setWorkspace] = useState<CleanSlateWorkspaceSnapshot | null>(initialWorkspaceSnapshot);
  const [toast, setToast] = useState<ToastNotice | null>(null);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', theme === 'dark');
    }
  }, [theme]);

  const notifyToast = useCallback((message: string, tone: ToastNotice['tone'] = 'success') => {
    setToast({ id: `${Date.now()}`, message, tone });
  }, []);

  const dismissToast = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const reloadWorkspace = useCallback(async () => {
    setLoadStatus('loading');
    setLoadError(null);
    try {
      if (authRepository) {
        // Hydrates authoritative actor & server-minted bound CSRF token in memory after reloads
        await authRepository.getMe();
      }
      const snap = await athleteRepo.hydrateWorkspace(activePersonaUid);
      setWorkspace(snap);
      setLoadStatus('ready');
    } catch (err) {
      const msg =
        err instanceof CleanSlateRepositoryError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'No se pudo cargar el workspace local.';
      setLoadError(msg);
      setLoadStatus('error');
    }
  }, [athleteRepo, authRepository, activePersonaUid]);

  useEffect(() => {
    if (currentRoute !== 'workspace') {
      return;
    }
    void reloadWorkspace();
  }, [reloadWorkspace, currentRoute]);

  const navigate = useCallback((view: ViewId) => {
    setActiveView(view);
  }, []);

  const navigateToPath = useCallback(
    (targetPath: string, options?: { replace?: boolean }) => {
      if (onNavigateRoute) {
        onNavigateRoute(targetPath, options);
      } else {
        navigateBrowserPath(targetPath, options);
      }
    },
    [onNavigateRoute]
  );

  const navigateToAuthLogin = useCallback(() => {
    const search = typeof window !== 'undefined' ? window.location.search : '';
    const loginPath = buildPathWithPreservedMode('/auth/login', search);
    navigateToPath(loginPath);
  }, [navigateToPath]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  const switchDevPersona = useCallback((uid: DevPersonaKey) => {
    setActivePersonaUid(uid);
  }, []);

  const setSimulatedFaultMode = useCallback(
    async (mode: MockFaultMode) => {
      setFaultMode(mode);
      if (athleteRepo instanceof InMemoryCleanSlateRepository) {
        athleteRepo.setFaultMode(mode);
      }
      await reloadWorkspace();
    },
    [athleteRepo, reloadWorkspace]
  );

  const resetMockSeed = useCallback(async () => {
    setFaultMode('none');
    if (athleteRepo instanceof InMemoryCleanSlateRepository) {
      athleteRepo.resetSeed();
    }
    await reloadWorkspace();
    notifyToast('Datos mock locales restaurados al estado inicial', 'info');
  }, [athleteRepo, reloadWorkspace, notifyToast]);

  const runMutation = useCallback(
    async <T,>(fn: () => Promise<T>, successMsg?: string): Promise<T> => {
      try {
        const res = await fn();
        if (successMsg) notifyToast(successMsg, 'success');
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Operación rechazada';
        notifyToast(msg, 'error');
        throw err;
      }
    },
    [notifyToast]
  );

  const logoutSession = useMemo(() => {
    if (!authRepository) return null;
    return async () => {
      try {
        await authRepository.logout();
        setWorkspace(null);
        setLoadError('Sesión HTTP cerrada. La cookie __Host-vigor_session fue revocada en el servidor.');
        setLoadStatus('error');
        notifyToast('Sesión cerrada correctamente', 'info');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Error cerrando sesión';
        notifyToast(msg, 'error');
        throw err;
      }
    };
  }, [authRepository, notifyToast]);

  const updateProfile = useCallback(
    async (patch: Record<string, unknown>) => {
      const updated = await runMutation(
        () => athleteRepo.updateOwnProfile(activePersonaUid, patch),
        athleteRepo.isLocalDevMock
          ? 'Perfil actualizado en mock local (solo memoria RAM)'
          : 'Perfil actualizado vía adaptador HTTP'
      );
      setWorkspace(prev => (prev ? { ...prev, profile: updated } : prev));
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const completeOnboarding = useCallback(
    async (input: OnboardingCompletionInput) => {
      const res = await runMutation(
        () => athleteRepo.completeOnboarding(activePersonaUid, input),
        'Onboarding completado y metas calculadas'
      );
      setWorkspace(prev =>
        prev
          ? {
              ...prev,
              profile: res.profile,
              biometrics: res.biometrics,
              preferences: res.preferences,
            }
          : prev
      );
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const saveBiometrics = useCallback(
    async (bio: BiometricsPayload) => {
      const saved = await runMutation(
        () => athleteRepo.saveBiometrics(activePersonaUid, bio),
        'Biometría y objetivos calóricos guardados'
      );
      setWorkspace(prev => (prev ? { ...prev, biometrics: saved } : prev));
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const savePreferences = useCallback(
    async (pref: PreferencesPayload) => {
      const saved = await runMutation(
        () => athleteRepo.savePreferences(activePersonaUid, pref),
        'Preferencias actualizadas'
      );
      setWorkspace(prev => (prev ? { ...prev, preferences: saved } : prev));
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const logMeal = useCallback(
    async (meal: Omit<MealLogRecord, 'id'>) => {
      const saved = await runMutation(
        () => athleteRepo.logMeal(activePersonaUid, meal),
        `Comida registrada: ${meal.name}`
      );
      setWorkspace(prev => (prev ? { ...prev, mealLogs: [saved, ...prev.mealLogs] } : prev));
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const deleteMeal = useCallback(
    async (mealId: string) => {
      await runMutation(() => athleteRepo.deleteMeal(activePersonaUid, mealId), 'Registro eliminado');
      setWorkspace(prev =>
        prev ? { ...prev, mealLogs: prev.mealLogs.filter(m => m.id !== mealId) } : prev
      );
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const saveRecipe = useCallback(
    async (recipe: RecipeRecord) => {
      const saved = await runMutation(
        () => athleteRepo.saveRecipe(activePersonaUid, recipe),
        `Receta guardada: ${recipe.name}`
      );
      setWorkspace(prev => {
        if (!prev) return prev;
        const exists = prev.recipes.some(r => r.id === saved.id);
        return {
          ...prev,
          recipes: exists
            ? prev.recipes.map(r => (r.id === saved.id ? saved : r))
            : [saved, ...prev.recipes],
        };
      });
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const deleteRecipe = useCallback(
    async (recipeId: string) => {
      await runMutation(() => athleteRepo.deleteRecipe(activePersonaUid, recipeId), 'Receta eliminada');
      setWorkspace(prev =>
        prev ? { ...prev, recipes: prev.recipes.filter(r => r.id !== recipeId) } : prev
      );
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const saveMealPlan = useCallback(
    async (plan: MealPlanRecord) => {
      const saved = await runMutation(
        () => athleteRepo.saveMealPlan(activePersonaUid, plan),
        'Menú semanal actualizado'
      );
      setWorkspace(prev => {
        if (!prev) return prev;
        const exists = prev.mealPlans.some(p => p.weekStart === saved.weekStart);
        return {
          ...prev,
          mealPlans: exists
            ? prev.mealPlans.map(p => (p.weekStart === saved.weekStart ? saved : p))
            : [saved, ...prev.mealPlans],
        };
      });
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const syncGroceries = useCallback(
    async (items: GroceryItemRecord[]) => {
      const res = await runMutation(
        () => athleteRepo.syncGroceries(activePersonaUid, items),
        `Lista sincronizada (${items.length} artículos en ${Math.max(1, Math.ceil(items.length / 25))} lote/s)`
      );
      setWorkspace(prev => (prev ? { ...prev, groceries: res.groceries } : prev));
      return { batchCalls: res.batchCalls };
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const toggleGrocery = useCallback(
    async (groceryId: string) => {
      const updated = await runMutation(() => athleteRepo.toggleGroceryStatus(activePersonaUid, groceryId));
      setWorkspace(prev =>
        prev
          ? {
              ...prev,
              groceries: prev.groceries.map(g => (g.id === groceryId ? updated : g)),
            }
          : prev
      );
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const addManualGrocery = useCallback(
    async (item: Omit<GroceryItemRecord, 'id'>) => {
      const created = await runMutation(
        () => athleteRepo.addManualGrocery(activePersonaUid, item),
        `Añadido: ${item.name}`
      );
      setWorkspace(prev => (prev ? { ...prev, groceries: [...prev.groceries, created] } : prev));
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const deleteGrocery = useCallback(
    async (groceryId: string) => {
      await runMutation(() => athleteRepo.deleteGrocery(activePersonaUid, groceryId), 'Artículo eliminado');
      setWorkspace(prev =>
        prev ? { ...prev, groceries: prev.groceries.filter(g => g.id !== groceryId) } : prev
      );
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const saveWorkoutRoutine = useCallback(
    async (routine: WorkoutRoutineRecord) => {
      const saved = await runMutation(
        () => athleteRepo.saveWorkoutRoutine(activePersonaUid, routine),
        `Rutina guardada: ${routine.name}`
      );
      setWorkspace(prev => {
        if (!prev) return prev;
        const base = saved.isDefault
          ? prev.workoutRoutines.map(r => ({ ...r, isDefault: false }))
          : prev.workoutRoutines;
        const exists = base.some(r => r.id === saved.id);
        return {
          ...prev,
          workoutRoutines: exists ? base.map(r => (r.id === saved.id ? saved : r)) : [saved, ...base],
        };
      });
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const setDefaultRoutine = useCallback(
    async (routineId: string) => {
      const updated = await runMutation(
        () => athleteRepo.setDefaultRoutine(activePersonaUid, routineId),
        'Rutina activa actualizada'
      );
      setWorkspace(prev => (prev ? { ...prev, workoutRoutines: updated } : prev));
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const startWorkout = useCallback(
    async (input: {
      routineId?: string;
      routineName: string;
      routineDayId?: string;
      routineDayName: string;
      exercisesSnapshot: ExecutedWorkoutRecord['exercisesSnapshot'];
    }) => {
      const started = await runMutation(
        () => athleteRepo.startExecutedWorkout(activePersonaUid, input),
        `Sesión iniciada: ${input.routineDayName}`
      );
      setWorkspace(prev =>
        prev ? { ...prev, executedWorkouts: [started, ...prev.executedWorkouts] } : prev
      );
      return started;
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const logWorkoutSet = useCallback(
    async (input: Omit<WorkoutSetRecord, 'id' | 'estimated1RM' | 'completedAt'>) => {
      const created = await runMutation(
        () => athleteRepo.logWorkoutSet(activePersonaUid, input),
        `Serie registrada (${input.weightKg} kg × ${input.reps})`
      );
      const refreshed = await athleteRepo.hydrateWorkspace(activePersonaUid);
      setWorkspace(refreshed);
      void created;
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const finishWorkout = useCallback(
    async (
      workoutId: string,
      finalStatus: 'completed' | 'abandoned',
      summary: { durationSeconds: number; sessionRpe?: number; notes?: string }
    ) => {
      const closed = await runMutation(
        () => athleteRepo.completeExecutedWorkout(activePersonaUid, workoutId, finalStatus, summary),
        finalStatus === 'completed'
          ? 'Sesión completada y sellada (inmutable)'
          : 'Sesión marcada como abandonada (inmutable)'
      );
      setWorkspace(prev =>
        prev
          ? {
              ...prev,
              executedWorkouts: prev.executedWorkouts.map(w => (w.id === closed.id ? closed : w)),
            }
          : prev
      );
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const addCardioSession = useCallback(
    async (session: Omit<CardioSessionRecord, 'id'>) => {
      const created = await runMutation(
        () => athleteRepo.addCardioSession(activePersonaUid, session),
        `Cardio registrado: ${session.title}`
      );
      setWorkspace(prev =>
        prev ? { ...prev, cardioSessions: [created, ...prev.cardioSessions] } : prev
      );
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const deleteCardioSession = useCallback(
    async (cardioId: string) => {
      await runMutation(
        () => athleteRepo.deleteCardioSession(activePersonaUid, cardioId),
        'Sesión cardio eliminada'
      );
      setWorkspace(prev =>
        prev ? { ...prev, cardioSessions: prev.cardioSessions.filter(c => c.id !== cardioId) } : prev
      );
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const createNotification = useCallback(
    async (notif: Omit<NotificationRecord, 'id' | 'createdAt' | 'read'>) => {
      const created = await runMutation(
        () => athleteRepo.createNotification(activePersonaUid, notif),
        'Notificación creada'
      );
      setWorkspace(prev =>
        prev ? { ...prev, notifications: [created, ...prev.notifications] } : prev
      );
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const markNotificationRead = useCallback(
    async (id: string, read = true) => {
      const updated = await runMutation(() =>
        athleteRepo.markNotificationRead(activePersonaUid, id, read)
      );
      setWorkspace(prev =>
        prev
          ? {
              ...prev,
              notifications: prev.notifications.map(n => (n.id === id ? updated : n)),
            }
          : prev
      );
    },
    [athleteRepo, activePersonaUid, runMutation]
  );

  const markAllNotificationsRead = useCallback(async () => {
    const updated = await runMutation(
      () => athleteRepo.markAllNotificationsRead(activePersonaUid),
      'Todas las notificaciones marcadas como leídas'
    );
    setWorkspace(prev => (prev ? { ...prev, notifications: updated } : prev));
  }, [athleteRepo, activePersonaUid, runMutation]);

  const todayIso = getTodayIsoDate();
  const todayMacros = useMemo(() => {
    const logs = (workspace?.mealLogs ?? []).filter(m => m.dateTime.startsWith(todayIso));
    return {
      calories: Math.round(logs.reduce((s, m) => s + m.kcal, 0)),
      protein: Math.round(logs.reduce((s, m) => s + m.protein, 0) * 10) / 10,
      carbs: Math.round(logs.reduce((s, m) => s + m.carbs, 0) * 10) / 10,
      fat: Math.round(logs.reduce((s, m) => s + m.fat, 0) * 10) / 10,
      mealsCount: logs.length,
    };
  }, [workspace?.mealLogs, todayIso]);

  const unreadNotificationsCount = useMemo(
    () => (workspace?.notifications ?? []).filter(n => !n.read).length,
    [workspace?.notifications]
  );

  const activeWorkout = useMemo(
    () => (workspace?.executedWorkouts ?? []).find(w => w.status === 'in_progress') ?? null,
    [workspace?.executedWorkouts]
  );

  const defaultRoutine = useMemo(() => {
    const list = workspace?.workoutRoutines ?? [];
    return list.find(r => r.isDefault) ?? list[0] ?? null;
  }, [workspace?.workoutRoutines]);

  const value: WorkspaceContextValue = {
    activeView,
    navigate,
    theme,
    toggleTheme,
    activePersonaUid,
    switchDevPersona,
    loadStatus,
    loadError,
    reloadWorkspace,
    faultMode,
    setSimulatedFaultMode,
    resetMockSeed,
    workspace,
    todayMacros,
    unreadNotificationsCount,
    activeWorkout,
    defaultRoutine,
    toast,
    notifyToast,
    dismissToast,
    athleteRepo,
    adminRepo,
    authRepository,
    authBridge,
    currentRoute,
    navigateToPath,
    navigateToAuthLogin,
    isLocalDevMock: athleteRepo.isLocalDevMock,
    repositoryModeLabel: athleteRepo.modeLabel,
    logoutSession,
    updateProfile,
    completeOnboarding,
    saveBiometrics,
    savePreferences,
    logMeal,
    deleteMeal,
    saveRecipe,
    deleteRecipe,
    saveMealPlan,
    syncGroceries,
    toggleGrocery,
    addManualGrocery,
    deleteGrocery,
    saveWorkoutRoutine,
    setDefaultRoutine,
    startWorkout,
    logWorkoutSet,
    finishWorkout,
    addCardioSession,
    deleteCardioSession,
    createNotification,
    markNotificationRead,
    markAllNotificationsRead,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error('useWorkspace debe usarse dentro de WorkspaceProvider');
  }
  return ctx;
}
