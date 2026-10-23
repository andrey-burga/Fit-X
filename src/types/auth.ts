export interface UserProfile {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  role: 'Atleta Pro' | 'Coach' | 'Nutricionista';
  location: string;
  joinedDate: string;
}

export type NotificationCategory = 'nutricion' | 'entrenamiento' | 'compras' | 'sistema';

export interface AppNotification {
  id: string;
  title: string;
  message: string;
  timestamp: string; // e.g. 'Hace 10 min'
  category: NotificationCategory;
  read: boolean;
  actionPath?: string;
  severity?: 'info' | 'success' | 'warning';
}

export interface NotificationPreferences {
  mealReminders: boolean;
  workoutAlerts: boolean;
  groceryAlerts: boolean;
  systemSync: boolean;
  soundEnabled: boolean;
  pushEnabled: boolean;
  pushPermission: 'default' | 'granted' | 'denied';
}
