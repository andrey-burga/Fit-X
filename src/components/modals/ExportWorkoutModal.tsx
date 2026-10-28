/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Export Workout History & Personal Records Modal (Increment 6E)
 * Provides comprehensive options for PDF generation, Excel CSVs, custom date/status filters,
 * live preview, and error handling.
 */

import React, { useState, useMemo } from 'react';
import { ExecutedWorkout } from '../../types/workout';
import { WorkoutSessionRecord } from '../../types';
import {
  WorkoutExportFilterOptions,
  ExportPeriodOption,
  ExportStatusOption,
  filterExecutedWorkouts,
  extractExportSets,
  computeExportSummaryStats,
  computePersonalRecords,
  generateSessionsSummaryCsv,
  generateSetsDetailCsv,
  downloadCsvFile,
  generateWorkoutPdfBlob,
  downloadPdfFile,
  generatePrintableHtml,
} from '../../services/workoutExportService';
import { getTodayLocalDateString } from '../../services/dateUtils';

interface ExportWorkoutModalProps {
  isOpen: boolean;
  onClose: () => void;
  executedWorkouts: ExecutedWorkout[];
  workoutHistory: WorkoutSessionRecord[];
  userName?: string;
  initialPeriod?: string;
  onShowToast: (text: string, type?: 'success' | 'info' | 'warning') => void;
}

export const ExportWorkoutModal: React.FC<ExportWorkoutModalProps> = ({
  isOpen,
  onClose,
  executedWorkouts,
  workoutHistory,
  userName = 'Atleta Vigor',
  initialPeriod = '12w',
  onShowToast,
}) => {
  const [period, setPeriod] = useState<ExportPeriodOption>(() => {
    if (initialPeriod === '24w' || initialPeriod === '1y' || initialPeriod === 'all') {
      return initialPeriod as ExportPeriodOption;
    }
    return '12w';
  });

  const [customStartDate, setCustomStartDate] = useState<string>(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  });
  const [customEndDate, setCustomEndDate] = useState<string>(getTodayLocalDateString());
  const [status, setStatus] = useState<ExportStatusOption>('all');
  const [specificWorkoutId, setSpecificWorkoutId] = useState<string>('all');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'options' | 'preview'>('options');

  // Filter options object
  const filterOptions = useMemo<WorkoutExportFilterOptions>(() => ({
    period,
    customStartDate,
    customEndDate,
    status,
    specificWorkoutId,
  }), [period, customStartDate, customEndDate, status, specificWorkoutId]);

  // Filtered workouts and stats
  const filteredWorkouts = useMemo(() => {
    return filterExecutedWorkouts(executedWorkouts, filterOptions);
  }, [executedWorkouts, filterOptions]);

  const periodLabel = useMemo(() => {
    switch (period) {
      case '12w': return 'Últimas 12 Semanas';
      case '24w': return 'Últimos 6 Meses (180 Días)';
      case '1y': return `Temporada ${new Date().getFullYear()}`;
      case 'custom': return `${customStartDate || 'Inicio'} a ${customEndDate || 'Hoy'}`;
      case 'all': return 'Todo el Historial';
      default: return 'Período Seleccionado';
    }
  }, [period, customStartDate, customEndDate]);

  const summary = useMemo(() => {
    return computeExportSummaryStats(filteredWorkouts, periodLabel);
  }, [filteredWorkouts, periodLabel]);

  const personalRecords = useMemo(() => {
    return computePersonalRecords(filteredWorkouts, workoutHistory);
  }, [filteredWorkouts, workoutHistory]);

  const filteredSets = useMemo(() => {
    return extractExportSets(filteredWorkouts, workoutHistory);
  }, [filteredWorkouts, workoutHistory]);

  if (!isOpen) return null;

  const todayStr = getTodayLocalDateString();

  // 1. PDF Export Handler
  const handleExportPdf = async () => {
    if (filteredWorkouts.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      onShowToast('Generando informe PDF profesional...', 'info');
      // Yield to UI loop for immediate spinner rendering
      await new Promise(r => setTimeout(r, 60));

      const blob = generateWorkoutPdfBlob(filterOptions, summary, filteredWorkouts, personalRecords, userName);
      const filename = `vigorcore_informe_entrenamiento_${todayStr}.pdf`;
      downloadPdfFile(blob, filename);

      onShowToast(`Informe PDF descargado: ${filename}`, 'success');
      onClose();
    } catch (err: any) {
      console.error('Error generando PDF:', err);
      onShowToast('Error al generar el archivo PDF: ' + (err.message || 'desconocido'), 'warning');
    } finally {
      setIsExporting(false);
    }
  };

  // 2. CSV Sessions Summary Handler
  const handleExportSessionsCsv = () => {
    if (filteredWorkouts.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const csv = generateSessionsSummaryCsv(filteredWorkouts);
      const filename = `vigorcore_resumen_sesiones_${todayStr}.csv`;
      downloadCsvFile(csv, filename);
      onShowToast(`Resumen de sesiones exportado: ${filename}`, 'success');
      onClose();
    } catch (err: any) {
      console.error('Error exportando CSV sesiones:', err);
      onShowToast('Error al exportar CSV de sesiones', 'warning');
    } finally {
      setIsExporting(false);
    }
  };

  // 3. CSV Sets Detail Handler
  const handleExportSetsCsv = () => {
    if (filteredWorkouts.length === 0 || isExporting) return;
    setIsExporting(true);
    try {
      const csv = generateSetsDetailCsv(filteredWorkouts, workoutHistory);
      const filename = `vigorcore_detalle_series_${todayStr}.csv`;
      downloadCsvFile(csv, filename);
      onShowToast(`Detalle de ${filteredSets.length} series exportado: ${filename}`, 'success');
      onClose();
    } catch (err: any) {
      console.error('Error exportando CSV series:', err);
      onShowToast('Error al exportar CSV de series', 'warning');
    } finally {
      setIsExporting(false);
    }
  };

  // 4. Print / HTML Preview Handler
  const handleOpenPrintPreview = () => {
    if (filteredWorkouts.length === 0 || isExporting) return;
    try {
      const html = generatePrintableHtml(summary, filteredWorkouts, personalRecords, userName);
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
        onShowToast('Vista previa de impresión abierta en nueva pestaña', 'info');
      } else {
        onShowToast('El navegador bloqueó la ventana emergente. Usa la descarga directa de PDF.', 'warning');
      }
    } catch (err: any) {
      onShowToast('No se pudo abrir la vista previa', 'warning');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-surface-container-lowest max-w-2xl w-full rounded-2xl shadow-2xl border border-surface-container flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150 my-auto max-h-[92vh]">
        {/* Header */}
        <div className="p-space-md sm:p-space-lg border-b border-surface-container/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center material-symbols-outlined text-xl shrink-0">
              file_download
            </span>
            <div className="flex flex-col">
              <h2 className="font-headline-md text-headline-md font-bold text-on-surface">
                Exportar Historial de Entrenamiento
              </h2>
              <span className="font-body-md text-xs text-secondary">
                Informes profesionales en PDF y CSV compatibles con Excel
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-surface-container-low hover:bg-surface-container text-secondary hover:text-on-surface flex items-center justify-center cursor-pointer transition-colors"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>

        {/* Tab Navigator */}
        <div className="flex items-center px-space-md sm:px-space-lg pt-2 border-b border-surface-container/60 bg-surface-container-low/40">
          <button
            type="button"
            onClick={() => setActiveTab('options')}
            className={`pb-2.5 px-3 font-label-md text-xs font-semibold border-b-2 transition-all cursor-pointer ${
              activeTab === 'options'
                ? 'border-primary text-primary'
                : 'border-transparent text-secondary hover:text-on-surface'
            }`}
          >
            Configuración y Filtros
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('preview')}
            className={`pb-2.5 px-3 font-label-md text-xs font-semibold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'preview'
                ? 'border-primary text-primary'
                : 'border-transparent text-secondary hover:text-on-surface'
            }`}
          >
            <span>Vista Previa</span>
            <span className="px-1.5 py-0.2 rounded-full bg-surface-container text-[10px] font-code-data font-bold">
              {filteredWorkouts.length}
            </span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-space-md sm:p-space-lg overflow-y-auto flex flex-col gap-space-md">
          {activeTab === 'options' ? (
            <>
              {/* Filter 1: Period Selection */}
              <div className="flex flex-col gap-1.5">
                <label className="font-label-sm text-xs font-bold uppercase tracking-wider text-secondary">
                  1. Período a Exportar
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {[
                    { id: '12w', label: 'Últimas 12 Semanas' },
                    { id: '24w', label: 'Últimos 6 Meses' },
                    { id: '1y', label: 'Temporada Actual' },
                    { id: 'all', label: 'Todo el Historial' },
                  ].map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPeriod(p.id as ExportPeriodOption)}
                      className={`py-2 px-2.5 rounded-xl text-xs font-label-md font-semibold text-center border transition-all cursor-pointer ${
                        period === p.id
                          ? 'bg-primary/10 border-primary text-primary shadow-xs'
                          : 'bg-surface-container-low border-surface-container/60 text-secondary hover:text-on-surface'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => setPeriod('custom')}
                    className={`text-xs font-label-md font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
                      period === 'custom' ? 'text-primary font-bold' : 'text-secondary hover:text-on-surface'
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">
                      {period === 'custom' ? 'radio_button_checked' : 'radio_button_unchecked'}
                    </span>
                    <span>O seleccionar intervalo personalizado de fechas</span>
                  </button>

                  {period === 'custom' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 p-2.5 rounded-xl bg-surface-container-low border border-surface-container/60 animate-in fade-in duration-100">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-label-sm text-secondary">Desde:</span>
                        <input
                          type="date"
                          value={customStartDate}
                          onChange={e => setCustomStartDate(e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg bg-surface-container-lowest text-xs text-on-surface border border-surface-container focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[11px] font-label-sm text-secondary">Hasta:</span>
                        <input
                          type="date"
                          value={customEndDate}
                          onChange={e => setCustomEndDate(e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg bg-surface-container-lowest text-xs text-on-surface border border-surface-container focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Filter 2: Status Selection */}
              <div className="flex flex-col gap-1.5">
                <label className="font-label-sm text-xs font-bold uppercase tracking-wider text-secondary">
                  2. Estado de Sesiones
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { id: 'all', label: 'Todas las Sesiones' },
                    { id: 'completed', label: 'Solo Completadas' },
                    { id: 'abandoned', label: 'Solo Canceladas' },
                  ].map(st => (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => setStatus(st.id as ExportStatusOption)}
                      className={`py-2 px-2.5 rounded-xl text-xs font-label-md font-semibold text-center border transition-all cursor-pointer ${
                        status === st.id
                          ? 'bg-primary/10 border-primary text-primary shadow-xs'
                          : 'bg-surface-container-low border-surface-container/60 text-secondary hover:text-on-surface'
                      }`}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filter 3: Specific Session (Optional) */}
              {executedWorkouts.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <label className="font-label-sm text-xs font-bold uppercase tracking-wider text-secondary">
                    3. Alcance de Sesión (Opcional)
                  </label>
                  <select
                    value={specificWorkoutId}
                    onChange={e => setSpecificWorkoutId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-surface-container-low text-xs text-on-surface border border-surface-container/60 focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                  >
                    <option value="all">Todas las sesiones que coincidan con el período ({executedWorkouts.length})</option>
                    {executedWorkouts.map(w => (
                      <option key={w.id} value={w.id}>
                        {new Date(w.startedAt).toLocaleDateString('es-ES')} • {w.routineName} ({w.status === 'completed' ? 'Completada' : 'Cancelada'}) - {w.totalTonnageKg} kg
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Live Match Summary Banner */}
              <div
                className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                  filteredWorkouts.length > 0
                    ? 'bg-primary/5 border-primary/20 text-on-surface'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-900'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`material-symbols-outlined text-xl shrink-0 ${
                      filteredWorkouts.length > 0 ? 'text-primary' : 'text-amber-500'
                    }`}
                  >
                    {filteredWorkouts.length > 0 ? 'verified' : 'info'}
                  </span>
                  <div className="flex flex-col">
                    <span className="font-headline-sm text-xs font-bold">
                      {filteredWorkouts.length > 0
                        ? `${filteredWorkouts.length} sesiones encontradas (${filteredSets.length} series registradas)`
                        : 'Sin sesiones para el filtro seleccionado'}
                    </span>
                    <span className="font-body-md text-[11px] text-secondary">
                      {filteredWorkouts.length > 0
                        ? `Tonelaje acumulado: ${summary.totalTonnageKg.toLocaleString()} kg • ${personalRecords.length} récords personales detectados`
                        : 'Ajusta el período o el filtro de estado para exportar datos reales.'}
                    </span>
                  </div>
                </div>

                {filteredWorkouts.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('preview')}
                    className="text-xs text-primary font-bold hover:underline shrink-0 text-left sm:text-right cursor-pointer"
                  >
                    Ver Desglose &rarr;
                  </button>
                )}
              </div>
            </>
          ) : (
            /* PREVIEW TAB */
            <div className="flex flex-col gap-space-sm">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2.5 rounded-xl bg-surface-container-low border border-surface-container/60 text-center">
                  <span className="text-[10px] uppercase font-semibold text-secondary">Sesiones</span>
                  <div className="font-code-data text-sm font-bold text-on-surface mt-0.5">
                    {summary.totalSessions}
                  </div>
                  <span className="text-[10px] text-secondary">
                    {summary.completedSessions} comp / {summary.abandonedSessions} canc
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-surface-container-low border border-surface-container/60 text-center">
                  <span className="text-[10px] uppercase font-semibold text-secondary">Tonelaje Efectivo</span>
                  <div className="font-code-data text-sm font-bold text-primary mt-0.5">
                    {summary.totalTonnageKg.toLocaleString()} kg
                  </div>
                  <span className="text-[10px] text-secondary">Warmup excluido</span>
                </div>
                <div className="p-2.5 rounded-xl bg-surface-container-low border border-surface-container/60 text-center">
                  <span className="text-[10px] uppercase font-semibold text-secondary">Series / Reps</span>
                  <div className="font-code-data text-sm font-bold text-on-surface mt-0.5">
                    {summary.totalCompletedSets} / {summary.totalReps}
                  </div>
                  <span className="text-[10px] text-secondary">Efectivas</span>
                </div>
                <div className="p-2.5 rounded-xl bg-surface-container-low border border-surface-container/60 text-center">
                  <span className="text-[10px] uppercase font-semibold text-secondary">RIR Medio</span>
                  <div className="font-code-data text-sm font-bold text-on-surface mt-0.5">
                    {summary.averageRir !== null ? summary.averageRir.toFixed(1) : '—'}
                  </div>
                  <span className="text-[10px] text-secondary">~{summary.averageDurationMinutes} min/sesión</span>
                </div>
              </div>

              {/* Workouts mini-list preview */}
              <div className="flex flex-col gap-1.5 mt-2 max-h-60 overflow-y-auto">
                <span className="text-[11px] font-bold uppercase tracking-wider text-secondary">
                  Sesiones que se incluirán en el informe ({filteredWorkouts.length}):
                </span>
                {filteredWorkouts.map((w, idx) => (
                  <div
                    key={w.id}
                    className="p-2 rounded-lg bg-surface-container-low border border-surface-container/60 flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-secondary">#{idx + 1}</span>
                      <div className="flex flex-col">
                        <span className="font-semibold text-on-surface">{w.routineName}</span>
                        <span className="text-[11px] text-secondary">
                          {new Date(w.startedAt).toLocaleDateString('es-ES')} • {w.routineDayName || 'General'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-code-data font-bold text-on-surface">{w.totalTonnageKg} kg</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          w.status === 'completed'
                            ? 'bg-primary/10 text-primary'
                            : 'bg-amber-500/10 text-amber-600'
                        }`}
                      >
                        {w.status === 'completed' ? 'Comp.' : 'Canc.'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons Footer */}
        <div className="p-space-md sm:p-space-lg border-t border-surface-container/60 bg-surface-container-low flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenPrintPreview}
              disabled={filteredWorkouts.length === 0 || isExporting}
              className="py-2 px-3 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border border-surface-container/60"
            >
              <span className="material-symbols-outlined text-base text-secondary">print</span>
              <span>Vista Previa / Imprimir</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportSessionsCsv}
              disabled={filteredWorkouts.length === 0 || isExporting}
              className="py-2 px-3 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border border-surface-container/60"
            >
              <span className="material-symbols-outlined text-base text-primary">table_chart</span>
              <span>CSV: Resumen</span>
            </button>

            <button
              type="button"
              onClick={handleExportSetsCsv}
              disabled={filteredWorkouts.length === 0 || isExporting}
              className="py-2 px-3 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface font-label-md text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed border border-surface-container/60"
            >
              <span className="material-symbols-outlined text-base text-primary">data_table</span>
              <span>CSV: Series</span>
            </button>

            <button
              type="button"
              onClick={handleExportPdf}
              disabled={filteredWorkouts.length === 0 || isExporting}
              className="py-2 px-4 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined text-base">
                {isExporting ? 'sync' : 'picture_as_pdf'}
              </span>
              <span>{isExporting ? 'Generando PDF...' : 'Descargar Informe PDF'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
