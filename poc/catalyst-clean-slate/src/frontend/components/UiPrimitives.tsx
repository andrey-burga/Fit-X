/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Accessible UI Primitives & State Panels
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw } from 'lucide-react';
import { CATALYST_BUDGET_LIMITS } from '../contracts/cleanSlateModels';

export interface SectionCardProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const SectionCard: React.FC<SectionCardProps> = ({
  title,
  subtitle,
  action,
  children,
  className = '',
}) => (
  <section
    className={`bg-surface border border-border rounded-xl p-5 flex flex-col gap-4 ${className}`}
  >
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
      <div>
        <h2 className="text-base font-semibold text-ink tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
    {children}
  </section>
);

export interface StatTileProps {
  label: string;
  value: string | number;
  detail?: string;
  tone?: 'neutral' | 'brand' | 'warn' | 'danger' | 'info';
}

export const StatTile: React.FC<StatTileProps> = ({ label, value, detail, tone = 'neutral' }) => {
  const toneColor =
    tone === 'brand'
      ? 'text-brand'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'danger'
          ? 'text-danger'
          : tone === 'info'
            ? 'text-info'
            : 'text-ink';

  return (
    <div className="bg-surface border border-border rounded-xl p-4 flex flex-col gap-1">
      <span className="text-xs font-medium text-ink-muted uppercase tracking-wider">{label}</span>
      <span className={`text-2xl font-bold tabular-nums tracking-tight ${toneColor}`}>{value}</span>
      {detail && <span className="text-xs text-ink-muted">{detail}</span>}
    </div>
  );
};

export interface InlineAlertProps {
  tone: 'info' | 'success' | 'warning' | 'error';
  title?: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export const InlineAlert: React.FC<InlineAlertProps> = ({ tone, title, children, action }) => {
  const styles =
    tone === 'error'
      ? 'bg-danger-soft border-danger/30 text-danger'
      : tone === 'warning'
        ? 'bg-warn-soft border-warn/30 text-warn'
        : tone === 'success'
          ? 'bg-brand-soft border-brand/30 text-brand-ink'
          : 'bg-info-soft border-info/30 text-info';

  const Icon =
    tone === 'error' || tone === 'warning'
      ? AlertTriangle
      : tone === 'success'
        ? CheckCircle2
        : Info;

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`border rounded-lg px-4 py-3 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${styles}`}
    >
      <div className="flex items-start gap-2.5">
        <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-0.5 text-ink">
          {title && <div className="font-semibold">{title}</div>}
          <div className="text-xs sm:text-sm text-ink-muted">{children}</div>
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
};

export interface StatePanelProps {
  mode: 'loading' | 'empty' | 'error';
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export const StatePanel: React.FC<StatePanelProps> = ({
  mode,
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
}) => (
  <div
    role={mode === 'error' ? 'alert' : 'status'}
    className="bg-surface border border-border rounded-xl p-8 flex flex-col items-center justify-center text-center gap-3 my-4"
  >
    {mode === 'loading' ? (
      <Loader2 className="w-7 h-7 text-brand animate-spin" aria-hidden="true" />
    ) : mode === 'error' ? (
      <AlertTriangle className="w-7 h-7 text-danger" aria-hidden="true" />
    ) : (
      <Info className="w-7 h-7 text-ink-muted" aria-hidden="true" />
    )}
    <h3 className="text-base font-semibold text-ink">{title}</h3>
    <p className="text-sm text-ink-muted max-w-md">{description}</p>
    {(actionLabel || secondaryActionLabel) && (
      <div className="mt-1 flex flex-wrap items-center justify-center gap-2.5">
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand hover:bg-brand-hover text-white text-sm font-medium cursor-pointer transition-colors"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            <span>{actionLabel}</span>
          </button>
        )}
        {secondaryActionLabel && onSecondaryAction && (
          <button
            type="button"
            onClick={onSecondaryAction}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-surface-alt hover:bg-canvas text-ink text-sm font-medium cursor-pointer transition-colors"
          >
            <span>{secondaryActionLabel}</span>
          </button>
        )}
      </div>
    )}
  </div>
);

export const PayloadBudgetMeter: React.FC<{ bytes: number; label?: string }> = ({
  bytes,
  label = 'Presupuesto Catalyst NoSQL',
}) => {
  const maxSafe = CATALYST_BUDGET_LIMITS.SAFE_PAYLOAD_BUDGET_BYTES;
  const pct = Math.min(100, Math.round((bytes / maxSafe) * 100));
  const kb = (bytes / 1024).toFixed(1);
  const safeKb = (maxSafe / 1024).toFixed(0);
  const overBudget = bytes > maxSafe;

  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex items-center justify-between text-ink-muted">
        <span>{label}</span>
        <span className={`font-mono tabular-nums font-medium ${overBudget ? 'text-danger' : 'text-ink'}`}>
          {kb} KB / {safeKb} KB
        </span>
      </div>
      <div className="h-1.5 w-full rounded bg-surface-alt overflow-hidden">
        <div
          className={`h-full transition-all ${overBudget ? 'bg-danger' : pct > 80 ? 'bg-warn' : 'bg-brand'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};
