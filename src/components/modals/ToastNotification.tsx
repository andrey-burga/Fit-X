import React from 'react';
import { useApp } from '../../context/AppContext';

export const ToastNotification: React.FC = () => {
  const { toast } = useApp();

  if (!toast) return null;

  return (
    <div className="fixed top-20 right-4 sm:right-8 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
      <div className="bg-inverse-surface text-inverse-on-surface px-space-md py-space-sm rounded-xl shadow-xl flex items-center gap-space-sm font-label-md text-label-md border border-outline-variant/20">
        <span className="material-symbols-outlined text-primary-fixed text-lg">
          {toast.type === 'warning' ? 'warning' : toast.type === 'info' ? 'info' : 'check_circle'}
        </span>
        <span>{toast.text}</span>
      </div>
    </div>
  );
};
