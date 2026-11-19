/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore Phase 4.2 — Cardio & HIIT Protocol Logger
 */

import React, { useMemo, useState } from 'react';
import { Flame, HeartPulse, Plus, Trash2 } from 'lucide-react';
import type { CardioSessionRecord } from '../contracts/cleanSlateModels';
import { getTodayIsoDate } from '../domain/nutritionEngine';
import { useWorkspace } from '../state/WorkspaceContext';
import { SectionCard, StatTile, StatePanel } from '../components/UiPrimitives';

const CARDIO_PRESETS: Array<{
  title: string;
  protocolType: CardioSessionRecord['protocolType'];
  durationMinutes: number;
  avgHeartRate: number;
  zone2Minutes: number;
  caloriesBurned: number;
}> = [
  { title: 'Aeróbico Zona 2 (Cinta Inclinada)', protocolType: 'zone2', durationMinutes: 40, avgHeartRate: 136, zone2Minutes: 36, caloriesBurned: 340 },
  { title: 'HIIT Noruego 4×4 min', protocolType: 'hiit', durationMinutes: 28, avgHeartRate: 162, zone2Minutes: 10, caloriesBurned: 325 },
  { title: 'Tempo Continuo en Remo', protocolType: 'tempo', durationMinutes: 25, avgHeartRate: 152, zone2Minutes: 8, caloriesBurned: 270 },
];

export const CardioHiitView: React.FC = () => {
  const { workspace, addCardioSession, deleteCardioSession } = useWorkspace();

  const [protocolFilter, setProtocolFilter] = useState<'all' | CardioSessionRecord['protocolType']>('all');
  const [date, setDate] = useState(getTodayIsoDate());
  const [title, setTitle] = useState('Aeróbico Zona 2 en Bicicleta');
  const [protocolType, setProtocolType] = useState<CardioSessionRecord['protocolType']>('zone2');
  const [durationMinutes, setDurationMinutes] = useState<number>(35);
  const [avgHeartRate, setAvgHeartRate] = useState<number>(138);
  const [zone2Minutes, setZone2Minutes] = useState<number>(30);
  const [caloriesBurned, setCaloriesBurned] = useState<number>(310);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const sessions = workspace?.cardioSessions ?? [];
  const filteredSessions = useMemo(
    () => (protocolFilter === 'all' ? sessions : sessions.filter(s => s.protocolType === protocolFilter)),
    [sessions, protocolFilter]
  );

  const totalMinutes = sessions.reduce((sum, s) => sum + s.durationMinutes, 0);
  const totalZone2Minutes = sessions.reduce((sum, s) => sum + (s.zone2Minutes ?? 0), 0);
  const totalKcal = sessions.reduce((sum, s) => sum + s.caloriesBurned, 0);

  if (!workspace) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await addCardioSession({
        date,
        title: title.trim(),
        protocolType,
        durationMinutes,
        avgHeartRate,
        zone2Minutes,
        caloriesBurned,
        notes: notes.trim() || undefined,
      });
      setNotes('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Sesiones Cardio" value={sessions.length} detail="Historial acumulado" />
        <StatTile label="Minutos Totales" value={`${totalMinutes} min`} tone="brand" detail="Volumen aeróbico/HIIT" />
        <StatTile label="Minutos Zona 2" value={`${totalZone2Minutes} min`} tone="info" detail="Base mitocondrial" />
        <StatTile label="Gasto Estimado" value={`${totalKcal} kcal`} detail="Acumulado registrado" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <SectionCard
          className="lg:col-span-5"
          title="Registrar Sesión Cardio / HIIT"
          subtitle="Valida duración [1..600 min] y FC promedio [35..240 bpm]"
        >
          <div className="flex flex-wrap gap-1.5">
            {CARDIO_PRESETS.map(p => (
              <button
                key={p.title}
                type="button"
                onClick={() => {
                  setTitle(p.title);
                  setProtocolType(p.protocolType);
                  setDurationMinutes(p.durationMinutes);
                  setAvgHeartRate(p.avgHeartRate);
                  setZone2Minutes(p.zone2Minutes);
                  setCaloriesBurned(p.caloriesBurned);
                }}
                className="px-2.5 py-1 rounded-lg border border-border bg-surface-alt hover:bg-canvas text-xs text-ink cursor-pointer"
              >
                {p.protocolType.toUpperCase()} · {p.durationMinutes}m
              </button>
            ))}
          </div>

          <form onSubmit={e => void handleSubmit(e)} className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="cardio-date" className="text-xs font-medium text-ink-muted">
                  Fecha
                </label>
                <input
                  id="cardio-date"
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink font-mono"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="cardio-proto" className="text-xs font-medium text-ink-muted">
                  Protocolo
                </label>
                <select
                  id="cardio-proto"
                  value={protocolType}
                  onChange={e => setProtocolType(e.target.value as CardioSessionRecord['protocolType'])}
                  className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink"
                >
                  <option value="zone2">Zona 2 Continua</option>
                  <option value="hiit">HIIT Interválico</option>
                  <option value="tempo">Tempo / Umbral</option>
                  <option value="recovery">Recuperación Activa</option>
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label htmlFor="cardio-title" className="text-xs font-medium text-ink-muted">
                Título de la sesión
              </label>
              <input
                id="cardio-title"
                type="text"
                required
                value={title}
                onChange={e => setTitle(e.target.value)}
                className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-ink"
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="space-y-1">
                <label htmlFor="cardio-dur" className="text-[11px] font-medium text-ink-muted">
                  Minutos
                </label>
                <input
                  id="cardio-dur"
                  type="number"
                  min={1}
                  max={600}
                  value={durationMinutes}
                  onChange={e => setDurationMinutes(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs text-ink font-mono"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="cardio-hr" className="text-[11px] font-medium text-ink-muted">
                  FC Prom (bpm)
                </label>
                <input
                  id="cardio-hr"
                  type="number"
                  min={35}
                  max={240}
                  value={avgHeartRate}
                  onChange={e => setAvgHeartRate(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs text-ink font-mono"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="cardio-z2" className="text-[11px] font-medium text-ink-muted">
                  Zona 2 (min)
                </label>
                <input
                  id="cardio-z2"
                  type="number"
                  min={0}
                  max={600}
                  value={zone2Minutes}
                  onChange={e => setZone2Minutes(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs text-ink font-mono"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="cardio-kcal" className="text-[11px] font-medium text-ink-muted">
                  Kcal
                </label>
                <input
                  id="cardio-kcal"
                  type="number"
                  min={0}
                  max={5000}
                  value={caloriesBurned}
                  onChange={e => setCaloriesBurned(Number(e.target.value) || 0)}
                  className="w-full rounded-lg border border-border bg-canvas px-2.5 py-2 text-xs text-ink font-mono"
                />
              </div>
            </div>

            <input
              aria-label="Notas de cardio"
              type="text"
              placeholder="Notas opcionales (cadencia, sensaciones...)"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-ink"
            />

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-sm font-medium cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{submitting ? 'Guardando...' : 'Registrar Sesión Cardio'}</span>
            </button>
          </form>
        </SectionCard>

        <SectionCard
          className="lg:col-span-7"
          title={`Historial Cardio (${filteredSessions.length})`}
          subtitle="Sesiones almacenadas como CARDIO_SESSION en la partición del atleta"
          action={
            <select
              aria-label="Filtrar protocolo cardio"
              value={protocolFilter}
              onChange={e => setProtocolFilter(e.target.value as typeof protocolFilter)}
              className="rounded-lg border border-border bg-canvas px-3 py-1.5 text-xs text-ink"
            >
              <option value="all">Todos los protocolos</option>
              <option value="zone2">Zona 2</option>
              <option value="hiit">HIIT</option>
              <option value="tempo">Tempo</option>
              <option value="recovery">Recuperación</option>
            </select>
          }
        >
          {filteredSessions.length === 0 ? (
            <StatePanel
              mode="empty"
              title="Sin sesiones cardiovasculares"
              description="Registra una sesión Zona 2 o HIIT para monitorizar gasto y minutos semanales."
            />
          ) : (
            <div className="divide-y divide-border">
              {filteredSessions.map(s => (
                <div key={s.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <HeartPulse className="w-4 h-4 text-brand shrink-0" />
                      <span className="text-sm font-semibold text-ink truncate">{s.title}</span>
                      <span className="text-[11px] uppercase font-mono px-1.5 py-0.5 rounded bg-surface-alt border border-border text-ink-muted">
                        {s.protocolType}
                      </span>
                    </div>
                    <div className="text-xs text-ink-muted font-mono tabular-nums flex flex-wrap gap-3">
                      <span>{s.date}</span>
                      <span>{s.durationMinutes} min</span>
                      {s.avgHeartRate !== undefined && <span>FC {s.avgHeartRate} bpm</span>}
                      <span className="inline-flex items-center gap-1 text-ink">
                        <Flame className="w-3 h-3 text-warn" />
                        {s.caloriesBurned} kcal
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void deleteCardioSession(s.id)}
                    aria-label={`Eliminar sesión ${s.title}`}
                    className="p-1.5 text-ink-muted hover:text-danger cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
};
