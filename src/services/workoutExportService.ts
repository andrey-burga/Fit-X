/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Workout History & Personal Records Export Engine (Increment 6E)
 * Generates professional PDF reports, Excel-compatible CSVs (Sessions Summary & Sets Detail),
 * and provides robust local filtering, calculation consistency, and data security.
 */

import { ExecutedWorkout, LiveExerciseSession, LiveWorkoutSet } from '../types/workout';
import { WorkoutSessionRecord } from '../types';
import { calculateEpley1RM, calculateSessionTonnage, calculateAverageRir } from '../utils/workoutCalculations';
import { getLocalDateString } from './dateUtils';

export type ExportPeriodOption = 'all' | '12w' | '24w' | '1y' | 'custom';
export type ExportStatusOption = 'all' | 'completed' | 'abandoned';

export interface WorkoutExportFilterOptions {
  period: ExportPeriodOption;
  customStartDate?: string; // 'YYYY-MM-DD'
  customEndDate?: string;   // 'YYYY-MM-DD'
  status: ExportStatusOption;
  specificWorkoutId?: string; // 'all' or specific workout ID
}

export interface ExportSetRecord {
  workoutId: string;
  workoutStartedAt: string;
  workoutStatus: 'completed' | 'abandoned' | 'in_progress';
  routineName: string;
  routineDayName: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: string;
  setNumber: number;
  setType: string; // 'warmup' | 'effective' | 'dropset' | 'failure'
  isWarmup: boolean;
  weightKg: number;
  reps: number;
  rir: number | null;
  rpe: number | null;
  estimated1RM: number | null;
  completed: boolean;
  setId: string;
  completedAt?: string;
}

export interface ExportPersonalRecord {
  exerciseId: string;
  exerciseName: string;
  weightKg: number;
  reps: number;
  rir: number | null;
  estimated1RM: number;
  date: string;
  workoutId?: string;
}

export interface ExportSummaryStats {
  totalSessions: number;
  completedSessions: number;
  abandonedSessions: number;
  inProgressSessions: number;
  totalTonnageKg: number;        // Warmup sets strictly excluded
  totalCompletedSets: number;    // Effective sets
  totalWarmupSets: number;
  totalReps: number;
  totalDurationSeconds: number;
  averageDurationMinutes: number;
  averageRir: number | null;
  averageSessionRpe: number | null;
  uniqueExercisesCount: number;
  periodLabel: string;
  generatedAt: string;
}

/**
 * Filter executed workouts according to chosen period, custom dates, status, and specific ID.
 */
export function filterExecutedWorkouts(
  workouts: ExecutedWorkout[],
  options: WorkoutExportFilterOptions
): ExecutedWorkout[] {
  if (!workouts || workouts.length === 0) return [];

  const now = new Date();
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  if (options.period === '12w') {
    minDate = new Date(now.getTime() - 12 * 7 * 24 * 60 * 60 * 1000);
  } else if (options.period === '24w') {
    minDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
  } else if (options.period === '1y') {
    const currentYear = now.getFullYear();
    minDate = new Date(`${currentYear}-01-01T00:00:00`);
    maxDate = new Date(`${currentYear}-12-31T23:59:59`);
  } else if (options.period === 'custom') {
    if (options.customStartDate) {
      minDate = new Date(`${options.customStartDate}T00:00:00`);
    }
    if (options.customEndDate) {
      maxDate = new Date(`${options.customEndDate}T23:59:59`);
    }
  }

  return workouts.filter(w => {
    // 1. Specific workout filter
    if (options.specificWorkoutId && options.specificWorkoutId !== 'all') {
      if (w.id !== options.specificWorkoutId) return false;
    }

    // 2. Status filter
    if (options.status !== 'all') {
      if (w.status !== options.status) return false;
    }

    // 3. Date filter
    const wDate = new Date(w.startedAt);
    if (isNaN(wDate.getTime())) return true; // Keep if invalid date string

    if (minDate && wDate < minDate) return false;
    if (maxDate && wDate > maxDate) return false;

    return true;
  });
}

/**
 * Flatten all executed sets from filtered workouts into structured rows.
 */
export function extractExportSets(
  workouts: ExecutedWorkout[],
  fallbackHistory: WorkoutSessionRecord[] = []
): ExportSetRecord[] {
  const sets: ExportSetRecord[] = [];
  const processedWorkoutIds = new Set<string>();

  workouts.forEach(w => {
    processedWorkoutIds.add(w.id);
    if (w.exercisesSnapshot && w.exercisesSnapshot.length > 0) {
      w.exercisesSnapshot.forEach(ex => {
        ex.sets.forEach(s => {
          const isWarmup = s.type === 'warmup';
          const epley = s.weightKg > 0 && s.reps > 0 ? calculateEpley1RM(s.weightKg, s.reps).value : null;
          const rirVal = s.rir !== undefined && s.rir !== null ? s.rir : (s.targetRir ?? null);
          const rpeVal = rirVal !== null && rirVal >= 0 && rirVal <= 10 ? 10 - rirVal : null;

          sets.push({
            workoutId: w.id,
            workoutStartedAt: w.startedAt,
            workoutStatus: w.status,
            routineName: w.routineName,
            routineDayName: w.routineDayName || '',
            exerciseId: ex.exerciseId,
            exerciseName: ex.exerciseName,
            muscleGroup: ex.muscleGroup || 'general',
            setNumber: s.setNumber,
            setType: s.type || 'effective',
            isWarmup,
            weightKg: s.weightKg,
            reps: s.reps,
            rir: rirVal,
            rpe: rpeVal,
            estimated1RM: s.estimated1RM > 0 ? s.estimated1RM : epley,
            completed: s.completed,
            setId: s.id,
            completedAt: s.completedAt || w.startedAt,
          });
        });
      });
    }
  });

  // If there are legacy standalone sets in workoutHistory that match filtered workout IDs or have no header
  fallbackHistory.forEach(h => {
    if (h.executedWorkoutId && processedWorkoutIds.has(h.executedWorkoutId)) {
      // Already extracted from exercisesSnapshot
      return;
    }
    const isWarmup = h.setType === 'warmup';
    const rirVal = h.rir !== undefined && h.rir !== null ? h.rir : null;
    const rpeVal = rirVal !== null && rirVal >= 0 && rirVal <= 10 ? 10 - rirVal : null;

    sets.push({
      workoutId: h.executedWorkoutId || 'legacy_standalone',
      workoutStartedAt: h.date,
      workoutStatus: 'completed',
      routineName: 'Registro Histórico',
      routineDayName: 'Individual',
      exerciseId: h.exerciseId,
      exerciseName: h.exerciseName,
      muscleGroup: 'general',
      setNumber: h.setNumber || 1,
      setType: h.setType || 'effective',
      isWarmup,
      weightKg: h.weightKg,
      reps: h.reps,
      rir: rirVal,
      rpe: rpeVal,
      estimated1RM: h.estimated1RM || (h.weightKg > 0 && h.reps > 0 ? calculateEpley1RM(h.weightKg, h.reps).value : null),
      completed: h.completed ?? true,
      setId: h.id,
      completedAt: h.date,
    });
  });

  return sets;
}

/**
 * Compute consolidated summary statistics for a set of workouts.
 */
export function computeExportSummaryStats(
  workouts: ExecutedWorkout[],
  periodLabel: string
): ExportSummaryStats {
  let completedSessions = 0;
  let abandonedSessions = 0;
  let inProgressSessions = 0;
  let totalTonnageKg = 0;
  let totalCompletedSets = 0;
  let totalWarmupSets = 0;
  let totalReps = 0;
  let totalDurationSeconds = 0;
  let sumRir = 0;
  let countRir = 0;
  let sumRpe = 0;
  let countRpe = 0;
  const uniqueExercises = new Set<string>();

  workouts.forEach(w => {
    if (w.status === 'completed') completedSessions++;
    else if (w.status === 'abandoned') abandonedSessions++;
    else inProgressSessions++;

    totalDurationSeconds += w.durationSeconds || 0;
    if (w.sessionRpe && w.sessionRpe > 0) {
      sumRpe += w.sessionRpe;
      countRpe++;
    }

    if (w.exercisesSnapshot && w.exercisesSnapshot.length > 0) {
      w.exercisesSnapshot.forEach(ex => {
        uniqueExercises.add(ex.exerciseId);
        ex.sets.forEach(s => {
          if (s.completed) {
            if (s.type === 'warmup') {
              totalWarmupSets++;
            } else {
              totalCompletedSets++;
              totalTonnageKg += Math.round(s.weightKg * s.reps);
              totalReps += s.reps;
              if (s.rir !== undefined && s.rir !== null) {
                sumRir += s.rir;
                countRir++;
              }
            }
          }
        });
      });
    } else {
      // Fallback to top-level fields
      totalTonnageKg += w.totalTonnageKg || 0;
      totalCompletedSets += w.totalCompletedSets || 0;
      totalReps += w.totalReps || 0;
    }
  });

  const totalSessions = workouts.length;
  const averageDurationMinutes = totalSessions > 0 ? Math.round((totalDurationSeconds / totalSessions) / 60) : 0;
  const averageRir = countRir > 0 ? Math.round((sumRir / countRir) * 10) / 10 : null;
  const averageSessionRpe = countRpe > 0 ? Math.round((sumRpe / countRpe) * 10) / 10 : null;

  return {
    totalSessions,
    completedSessions,
    abandonedSessions,
    inProgressSessions,
    totalTonnageKg,
    totalCompletedSets,
    totalWarmupSets,
    totalReps,
    totalDurationSeconds,
    averageDurationMinutes,
    averageRir,
    averageSessionRpe,
    uniqueExercisesCount: uniqueExercises.size,
    periodLabel,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Calculates highest Personal Records (PRs) per exercise using Epley 1RM.
 */
export function computePersonalRecords(
  workouts: ExecutedWorkout[],
  fallbackHistory: WorkoutSessionRecord[] = []
): ExportPersonalRecord[] {
  const prMap = new Map<string, ExportPersonalRecord>();

  // Process all sets from snapshot
  workouts.forEach(w => {
    if (w.exercisesSnapshot) {
      w.exercisesSnapshot.forEach(ex => {
        ex.sets.forEach(s => {
          if (s.completed && s.type !== 'warmup' && s.weightKg > 0 && s.reps > 0) {
            const epley = calculateEpley1RM(s.weightKg, s.reps).value;
            const existing = prMap.get(ex.exerciseId);
            if (!existing || epley > existing.estimated1RM) {
              prMap.set(ex.exerciseId, {
                exerciseId: ex.exerciseId,
                exerciseName: ex.exerciseName,
                weightKg: s.weightKg,
                reps: s.reps,
                rir: s.rir ?? null,
                estimated1RM: epley,
                date: s.completedAt || w.startedAt,
                workoutId: w.id,
              });
            }
          }
        });
      });
    }
  });

  // Also include standalone sets from workoutHistory
  fallbackHistory.forEach(h => {
    if (h.completed && h.setType !== 'warmup' && h.weightKg > 0 && h.reps > 0) {
      const epley = calculateEpley1RM(h.weightKg, h.reps).value;
      const existing = prMap.get(h.exerciseId);
      if (!existing || epley > existing.estimated1RM) {
        prMap.set(h.exerciseId, {
          exerciseId: h.exerciseId,
          exerciseName: h.exerciseName,
          weightKg: h.weightKg,
          reps: h.reps,
          rir: h.rir ?? null,
          estimated1RM: epley,
          date: h.date,
          workoutId: h.executedWorkoutId,
        });
      }
    }
  });

  return Array.from(prMap.values()).sort((a, b) => b.estimated1RM - a.estimated1RM);
}

// ============================================================================
// CSV GENERATION (Excel Compatible with UTF-8 BOM and RFC-4180 Escaping)
// ============================================================================

/**
 * Helper to escape CSV values according to RFC 4180.
 * Wraps values with quotes if they contain commas, newlines, or quotes.
 */
function escapeCsvValue(val: any): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('\n') || str.includes('\r') || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generates CSV 1: Sessions Summary (one row per workout session).
 */
export function generateSessionsSummaryCsv(workouts: ExecutedWorkout[]): string {
  const headers = [
    'ID Sesion',
    'Fecha Inicio',
    'Fecha Finalizacion',
    'Estado',
    'Nombre Rutina',
    'Dia / Enfoque',
    'Duracion (minutos)',
    'Tonelaje Efectivo (kg)',
    'Numero Ejercicios',
    'Series Completadas',
    'Repeticiones Totales',
    'RIR Promedio',
    'RPE Sesion',
    'Notas',
  ];

  const rows: string[] = [];
  rows.push(headers.map(escapeCsvValue).join(','));

  workouts.forEach(w => {
    const isCompleted = w.status === 'completed';
    const isAbandoned = w.status === 'abandoned';
    const estadoStr = isCompleted ? 'Completado' : isAbandoned ? 'Cancelado / Abandonado' : 'En Curso';

    const durationMin = w.durationSeconds ? Math.round(w.durationSeconds / 60) : 0;
    const exerciseCount = w.exercisesSnapshot ? w.exercisesSnapshot.length : 0;
    const rpeStr = w.sessionRpe && w.sessionRpe > 0 ? w.sessionRpe.toFixed(1) : '';
    const rirStr = w.averageRir && w.averageRir > 0 ? w.averageRir.toFixed(1) : '';

    const row = [
      w.id,
      w.startedAt ? new Date(w.startedAt).toLocaleString('es-ES') : '',
      w.completedAt ? new Date(w.completedAt).toLocaleString('es-ES') : '',
      estadoStr,
      w.routineName || 'Entrenamiento Libre',
      w.routineDayName || 'Sesion General',
      durationMin,
      w.totalTonnageKg || 0,
      exerciseCount,
      w.totalCompletedSets || 0,
      w.totalReps || 0,
      rirStr,
      rpeStr,
      w.notes || '',
    ];

    rows.push(row.map(escapeCsvValue).join(','));
  });

  // Prepend UTF-8 BOM (\uFEFF) for Excel compatibility
  return '\uFEFF' + rows.join('\r\n');
}

/**
 * Generates CSV 2: Sets Detail (one row per executed set).
 */
export function generateSetsDetailCsv(
  workouts: ExecutedWorkout[],
  fallbackHistory: WorkoutSessionRecord[] = []
): string {
  const headers = [
    'ID Sesion',
    'Fecha Serie',
    'Estado Sesion',
    'Nombre Rutina',
    'Dia / Enfoque',
    'ID Ejercicio',
    'Nombre Ejercicio',
    'Grupo Muscular',
    'Numero Serie',
    'Tipo Serie',
    'Es Calentamiento',
    'Peso (kg)',
    'Repeticiones',
    'RIR',
    'RPE Estimado',
    '1RM Estimado (kg)',
    'ID Serie',
  ];

  const rows: string[] = [];
  rows.push(headers.map(escapeCsvValue).join(','));

  const sets = extractExportSets(workouts, fallbackHistory);

  sets.forEach(s => {
    const estadoSesion = s.workoutStatus === 'completed'
      ? 'Completado'
      : s.workoutStatus === 'abandoned'
      ? 'Cancelado'
      : 'En Curso';

    const tipoSerieStr = s.setType === 'warmup'
      ? 'Calentamiento'
      : s.setType === 'dropset'
      ? 'Drop Set'
      : s.setType === 'failure'
      ? 'Al Fallo'
      : 'Efectiva';

    const row = [
      s.workoutId,
      s.completedAt ? new Date(s.completedAt).toLocaleString('es-ES') : '',
      estadoSesion,
      s.routineName,
      s.routineDayName,
      s.exerciseId,
      s.exerciseName,
      s.muscleGroup,
      s.setNumber,
      tipoSerieStr,
      s.isWarmup ? 'SI' : 'NO',
      s.weightKg,
      s.reps,
      s.rir !== null ? s.rir : '',
      s.rpe !== null ? s.rpe : '',
      s.estimated1RM !== null ? s.estimated1RM.toFixed(1) : '',
      s.setId,
    ];

    rows.push(row.map(escapeCsvValue).join(','));
  });

  // Prepend UTF-8 BOM
  return '\uFEFF' + rows.join('\r\n');
}

/**
 * Triggers a browser download of CSV content with proper object URL revocation.
 */
export function downloadCsvFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 300);
}

// ============================================================================
// PURE TYPESCRIPT VECTOR PDF BUILDER (PDF 1.4 Native Specification)
// ============================================================================

/**
 * Sanitizes Spanish text for Standard 14 PDF fonts (Helvetica) using Octal Escapes.
 * Handles: á, é, í, ó, ú, ñ, Á, É, Í, Ó, Ú, Ñ, °, etc.
 */
function sanitizePdfString(str: string): string {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/á/g, '\\341')
    .replace(/é/g, '\\351')
    .replace(/í/g, '\\355')
    .replace(/ó/g, '\\363')
    .replace(/ú/g, '\\372')
    .replace(/ñ/g, '\\361')
    .replace(/Á/g, '\\301')
    .replace(/É/g, '\\311')
    .replace(/Í/g, '\\315')
    .replace(/Ó/g, '\\323')
    .replace(/Ú/g, '\\332')
    .replace(/Ñ/g, '\\321')
    .replace(/ü/g, '\\374')
    .replace(/Ü/g, '\\334')
    .replace(/°/g, '\\260')
    .replace(/•/g, '-')
    .replace(/—/g, '-')
    .replace(/[^\x00-\x7F\\]/g, ' '); // fallback safe ascii
}

interface PdfPageContent {
  streamOps: string[];
}

/**
 * Lightweight, robust multi-page PDF builder emitting compliant PDF-1.4 binary.
 */
export class NativePdfDocument {
  private pages: PdfPageContent[] = [];
  private currentPageIndex: number = -1;
  private currentY: number = 780; // A4 height is ~841.89pt
  private readonly pageWidth: number = 595.28;
  private readonly pageHeight: number = 841.89;
  private readonly marginLeft: number = 40;
  private readonly marginRight: number = 555.28;
  private readonly marginBottom: number = 50;

  constructor() {
    this.addPage();
  }

  public addPage(): void {
    this.pages.push({ streamOps: [] });
    this.currentPageIndex++;
    this.currentY = 780;
  }

  public getPageCount(): number {
    return this.pages.length;
  }

  public getCurrentY(): number {
    return this.currentY;
  }

  public ensureSpace(neededHeight: number): void {
    if (this.currentY - neededHeight < this.marginBottom) {
      this.addPage();
    }
  }

  public drawRect(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
    stroke: boolean = false
  ): void {
    const curPage = this.pages[this.currentPageIndex];
    if (stroke) {
      curPage.streamOps.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`);
      curPage.streamOps.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S`);
    } else {
      curPage.streamOps.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg`);
      curPage.streamOps.push(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
    }
  }

  public drawLine(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    r: number = 0.8,
    g: number = 0.8,
    b: number = 0.8,
    lineWidth: number = 0.5
  ): void {
    const curPage = this.pages[this.currentPageIndex];
    curPage.streamOps.push(`${lineWidth.toFixed(2)} w`);
    curPage.streamOps.push(`${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG`);
    curPage.streamOps.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  public addText(
    text: string,
    x: number,
    y: number,
    options: {
      fontSize?: number;
      font?: 'F1' | 'F2' | 'F3'; // F1 = Helvetica, F2 = Bold, F3 = Oblique
      r?: number;
      g?: number;
      b?: number;
    } = {}
  ): void {
    const fontSize = options.fontSize || 10;
    const font = options.font || 'F1';
    const r = options.r !== undefined ? options.r : 0.15;
    const g = options.g !== undefined ? options.g : 0.15;
    const b = options.b !== undefined ? options.b : 0.15;

    const safeText = sanitizePdfString(text);
    const curPage = this.pages[this.currentPageIndex];

    curPage.streamOps.push(
      `BT /${font} ${fontSize} Tf ${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${safeText}) Tj ET`
    );
  }

  public moveDown(delta: number): void {
    this.currentY -= delta;
  }

  public buildBytes(): Uint8Array {
    const totalPages = this.pages.length;

    // Stamp running footers on all pages ("Página X de Y")
    for (let p = 0; p < totalPages; p++) {
      const page = this.pages[p];
      const pageStr = sanitizePdfString(`Página ${p + 1} de ${totalPages} • VigorCore Sports Performance Engine • Confidencial`);
      page.streamOps.push(
        `BT /F1 8 Tf 0.5 0.5 0.5 rg 1 0 0 1 40 25 Tm (${pageStr}) Tj ET`
      );
      // Top subtle header line for pages > 1
      if (p > 0) {
        page.streamOps.push(`0.5 w 0.85 0.85 0.85 RG 40 810 m 555.28 810 l S`);
        const headerTitle = sanitizePdfString('VIGORCORE • INFORME TÉCNICO DE ENTRENAMIENTO Y RENDIMIENTO');
        page.streamOps.push(
          `BT /F2 8 Tf 0.4 0.4 0.4 rg 1 0 0 1 40 815 Tm (${headerTitle}) Tj ET`
        );
      }
    }

    const objects: string[] = [];
    const offsets: number[] = [];

    // Header
    let output = '%PDF-1.4\r\n%\xE2\xE3\xCF\xD3\r\n';

    // 1: Catalog
    // 2: Pages
    // For each page:
    // Page obj: (3 + 2*i)
    // Contents obj: (4 + 2*i)

    const catalogObjIndex = 1;
    const pagesObjIndex = 2;
    const pageObjStart = 3;

    // Reserve catalog & pages objects
    const pageKidsRefs: string[] = [];
    for (let i = 0; i < totalPages; i++) {
      const pageObjNum = pageObjStart + i * 2;
      pageKidsRefs.push(`${pageObjNum} 0 R`);
    }

    const catalogStr = `${catalogObjIndex} 0 obj\r\n<< /Type /Catalog /Pages ${pagesObjIndex} 0 R >>\r\nendobj\r\n`;
    const pagesStr = `${pagesObjIndex} 0 obj\r\n<< /Type /Pages /Kids [${pageKidsRefs.join(' ')}] /Count ${totalPages} >>\r\nendobj\r\n`;

    const allObjectsStrings: { num: number; body: string }[] = [
      { num: catalogObjIndex, body: catalogStr },
      { num: pagesObjIndex, body: pagesStr },
    ];

    for (let i = 0; i < totalPages; i++) {
      const pageObjNum = pageObjStart + i * 2;
      const contentObjNum = pageObjNum + 1;
      const streamText = this.pages[i].streamOps.join('\r\n') + '\r\n';
      const streamLength = new TextEncoder().encode(streamText).length;

      const pageObjBody = `${pageObjNum} 0 obj\r\n<< /Type /Page /Parent ${pagesObjIndex} 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> /F3 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >> >> >> /Contents ${contentObjNum} 0 R >>\r\nendobj\r\n`;

      const contentObjBody = `${contentObjNum} 0 obj\r\n<< /Length ${streamLength} >>\r\nstream\r\n${streamText}endstream\r\nendobj\r\n`;

      allObjectsStrings.push({ num: pageObjNum, body: pageObjBody });
      allObjectsStrings.push({ num: contentObjNum, body: contentObjBody });
    }

    // Assemble file with byte offsets
    let currentBytePos = new TextEncoder().encode(output).length;

    // Store offsets
    const objOffsetsMap: Record<number, number> = {};

    allObjectsStrings.forEach(obj => {
      objOffsetsMap[obj.num] = currentBytePos;
      output += obj.body;
      currentBytePos = new TextEncoder().encode(output).length;
    });

    const startXrefPos = currentBytePos;
    const totalObjsCount = allObjectsStrings.length + 1; // including 0

    let xrefStr = `xref\r\n0 ${totalObjsCount}\r\n0000000000 65535 f\r\n`;
    for (let num = 1; num < totalObjsCount; num++) {
      const off = objOffsetsMap[num] || 0;
      xrefStr += `${String(off).padStart(10, '0')} 00000 n\r\n`;
    }

    const trailerStr = `trailer\r\n<< /Size ${totalObjsCount} /Root ${catalogObjIndex} 0 R >>\r\nstartxref\r\n${startXrefPos}\r\n%%EOF\r\n`;

    output += xrefStr + trailerStr;
    return new TextEncoder().encode(output);
  }
}

/**
 * Builds the comprehensive vector PDF report Blob.
 */
export function generateWorkoutPdfBlob(
  options: WorkoutExportFilterOptions,
  summary: ExportSummaryStats,
  workouts: ExecutedWorkout[],
  personalRecords: ExportPersonalRecord[],
  userName: string = 'Atleta Vigor'
): Blob {
  const doc = new NativePdfDocument();

  // 1. HEADER BANNER (Page 1)
  doc.drawRect(40, 755, 515.28, 48, 0.12, 0.44, 0.28, false); // Vigor Green Header
  doc.addText('VIGORCORE • SPORTS PERFORMANCE REPORT', 52, 786, { fontSize: 13, font: 'F2', r: 1, g: 1, b: 1 });
  doc.addText('Informe Oficial de Rendimiento, Sobrecarga Progresiva y Sesiones Auditadas', 52, 768, {
    fontSize: 9,
    font: 'F1',
    r: 0.9,
    g: 0.95,
    b: 0.9,
  });

  doc.moveDown(58);

  // 2. METADATA STRIP
  const genDateStr = new Date().toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  doc.addText(`Atleta: ${userName}`, 42, doc.getCurrentY(), { fontSize: 10, font: 'F2', r: 0.1, g: 0.1, b: 0.1 });
  doc.addText(`Fecha de emision: ${genDateStr}`, 300, doc.getCurrentY(), { fontSize: 9, font: 'F1', r: 0.4, g: 0.4, b: 0.4 });
  doc.moveDown(14);
  doc.addText(`Periodo: ${summary.periodLabel}`, 42, doc.getCurrentY(), { fontSize: 9, font: 'F1', r: 0.3, g: 0.3, b: 0.3 });
  doc.addText(`Filtro de Estado: ${options.status === 'all' ? 'Todas las Sesiones' : options.status === 'completed' ? 'Solo Completadas' : 'Solo Canceladas'}`, 300, doc.getCurrentY(), { fontSize: 9, font: 'F1', r: 0.3, g: 0.3, b: 0.3 });

  doc.moveDown(18);
  doc.drawLine(40, doc.getCurrentY(), 555.28, doc.getCurrentY(), 0.85, 0.85, 0.85, 1);
  doc.moveDown(15);

  // 3. EXECUTIVE KPI METRICS GRID
  doc.addText('RESUMEN EJECUTIVO DEL PERÍODO', 42, doc.getCurrentY(), { fontSize: 11, font: 'F2', r: 0.1, g: 0.3, b: 0.15 });
  doc.moveDown(14);

  // Box 1: Sessions
  doc.drawRect(40, doc.getCurrentY() - 40, 120, 44, 0.96, 0.97, 0.96, false);
  doc.drawRect(40, doc.getCurrentY() - 40, 120, 44, 0.85, 0.88, 0.85, true);
  doc.addText('SESIONES', 48, doc.getCurrentY() - 12, { fontSize: 8, font: 'F2', r: 0.4, g: 0.4, b: 0.4 });
  doc.addText(`${summary.totalSessions} Total`, 48, doc.getCurrentY() - 25, { fontSize: 12, font: 'F2', r: 0.1, g: 0.1, b: 0.1 });
  doc.addText(`${summary.completedSessions} comp • ${summary.abandonedSessions} canc`, 48, doc.getCurrentY() - 36, { fontSize: 7, font: 'F1', r: 0.4, g: 0.4, b: 0.4 });

  // Box 2: Tonnage
  doc.drawRect(168, doc.getCurrentY() - 40, 130, 44, 0.96, 0.97, 0.96, false);
  doc.drawRect(168, doc.getCurrentY() - 40, 130, 44, 0.85, 0.88, 0.85, true);
  doc.addText('TONELAJE EFECTIVO', 176, doc.getCurrentY() - 12, { fontSize: 8, font: 'F2', r: 0.4, g: 0.4, b: 0.4 });
  doc.addText(`${summary.totalTonnageKg.toLocaleString()} kg`, 176, doc.getCurrentY() - 25, { fontSize: 12, font: 'F2', r: 0.12, g: 0.44, b: 0.28 });
  doc.addText('Excluye calentamiento', 176, doc.getCurrentY() - 36, { fontSize: 7, font: 'F3', r: 0.4, g: 0.4, b: 0.4 });

  // Box 3: Sets & Reps
  doc.drawRect(306, doc.getCurrentY() - 40, 120, 44, 0.96, 0.97, 0.96, false);
  doc.drawRect(306, doc.getCurrentY() - 40, 120, 44, 0.85, 0.88, 0.85, true);
  doc.addText('VOLUMEN DE SERIES', 314, doc.getCurrentY() - 12, { fontSize: 8, font: 'F2', r: 0.4, g: 0.4, b: 0.4 });
  doc.addText(`${summary.totalCompletedSets} series`, 314, doc.getCurrentY() - 25, { fontSize: 12, font: 'F2', r: 0.1, g: 0.1, b: 0.1 });
  doc.addText(`${summary.totalReps} repeticiones tot.`, 314, doc.getCurrentY() - 36, { fontSize: 7, font: 'F1', r: 0.4, g: 0.4, b: 0.4 });

  // Box 4: Quality & Duration
  doc.drawRect(434, doc.getCurrentY() - 40, 121.28, 44, 0.96, 0.97, 0.96, false);
  doc.drawRect(434, doc.getCurrentY() - 40, 121.28, 44, 0.85, 0.88, 0.85, true);
  doc.addText('RIR MEDIO / TIEMPO', 442, doc.getCurrentY() - 12, { fontSize: 8, font: 'F2', r: 0.4, g: 0.4, b: 0.4 });
  doc.addText(`RIR ${summary.averageRir !== null ? summary.averageRir.toFixed(1) : '-'}`, 442, doc.getCurrentY() - 25, { fontSize: 12, font: 'F2', r: 0.1, g: 0.1, b: 0.1 });
  doc.addText(`~${summary.averageDurationMinutes} min / sesion`, 442, doc.getCurrentY() - 36, { fontSize: 7, font: 'F1', r: 0.4, g: 0.4, b: 0.4 });

  doc.moveDown(55);

  // 4. PERSONAL RECORDS (PRs) SECTION
  if (personalRecords.length > 0) {
    doc.ensureSpace(80);
    doc.addText('RÉCORDS PERSONALES DESTACADOS (1RM ESTIMACIÓN EPLEY)', 42, doc.getCurrentY(), {
      fontSize: 10,
      font: 'F2',
      r: 0.12,
      g: 0.44,
      b: 0.28,
    });
    doc.moveDown(12);

    // Table Header
    doc.drawRect(40, doc.getCurrentY() - 16, 515.28, 18, 0.92, 0.94, 0.92, false);
    doc.addText('EJERCICIO', 48, doc.getCurrentY() - 12, { fontSize: 8, font: 'F2', r: 0.2, g: 0.2, b: 0.2 });
    doc.addText('CARGA REAL', 250, doc.getCurrentY() - 12, { fontSize: 8, font: 'F2', r: 0.2, g: 0.2, b: 0.2 });
    doc.addText('RIR', 330, doc.getCurrentY() - 12, { fontSize: 8, font: 'F2', r: 0.2, g: 0.2, b: 0.2 });
    doc.addText('1RM ESTIMADO', 380, doc.getCurrentY() - 12, { fontSize: 8, font: 'F2', r: 0.2, g: 0.2, b: 0.2 });
    doc.addText('FECHA', 470, doc.getCurrentY() - 12, { fontSize: 8, font: 'F2', r: 0.2, g: 0.2, b: 0.2 });
    doc.moveDown(18);

    // Render top PRs (max 6 to avoid cluttering page 1)
    personalRecords.slice(0, 6).forEach(pr => {
      doc.ensureSpace(16);
      const prDate = pr.date ? new Date(pr.date).toLocaleDateString('es-ES') : '-';
      doc.addText(pr.exerciseName, 48, doc.getCurrentY() - 10, { fontSize: 8, font: 'F2', r: 0.1, g: 0.1, b: 0.1 });
      doc.addText(`${pr.weightKg} kg x ${pr.reps} reps`, 250, doc.getCurrentY() - 10, { fontSize: 8, font: 'F1', r: 0.2, g: 0.2, b: 0.2 });
      doc.addText(pr.rir !== null ? `@ RIR ${pr.rir}` : '-', 330, doc.getCurrentY() - 10, { fontSize: 8, font: 'F1', r: 0.4, g: 0.4, b: 0.4 });
      doc.addText(`${pr.estimated1RM.toFixed(1)} kg`, 380, doc.getCurrentY() - 10, { fontSize: 8, font: 'F2', r: 0.12, g: 0.44, b: 0.28 });
      doc.addText(prDate, 470, doc.getCurrentY() - 10, { fontSize: 8, font: 'F1', r: 0.4, g: 0.4, b: 0.4 });
      doc.drawLine(40, doc.getCurrentY() - 14, 555.28, doc.getCurrentY() - 14, 0.9, 0.9, 0.9, 0.5);
      doc.moveDown(16);
    });
  }

  doc.moveDown(15);

  // 5. DETAILED CHRONOLOGICAL WORKOUT SESSIONS
  doc.ensureSpace(60);
  doc.addText('HISTORIAL CRONOLÓGICO Y DESGLOSE DE SESIONES', 42, doc.getCurrentY(), {
    fontSize: 10,
    font: 'F2',
    r: 0.1,
    g: 0.3,
    b: 0.15,
  });
  doc.moveDown(14);

  if (workouts.length === 0) {
    doc.addText('No se encontraron sesiones registradas en el periodo seleccionado.', 48, doc.getCurrentY(), {
      fontSize: 9,
      font: 'F3',
      r: 0.5,
      g: 0.5,
      b: 0.5,
    });
  } else {
    workouts.forEach((w, wIdx) => {
      // Need space for session header + at least 1 exercise
      doc.ensureSpace(90);

      const isCompleted = w.status === 'completed';
      const isAbandoned = w.status === 'abandoned';
      const statusLabel = isCompleted ? '[COMPLETADA]' : isAbandoned ? '[CANCELADA / ABANDONADA]' : '[EN CURSO]';
      const startDate = w.startedAt ? new Date(w.startedAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
      const durMin = w.durationSeconds ? Math.round(w.durationSeconds / 60) : 0;

      // Session Header Card
      const headerColorR = isCompleted ? 0.94 : 0.98;
      const headerColorG = isCompleted ? 0.97 : 0.95;
      const headerColorB = isCompleted ? 0.94 : 0.90;
      doc.drawRect(40, doc.getCurrentY() - 20, 515.28, 22, headerColorR, headerColorG, headerColorB, false);
      doc.drawRect(40, doc.getCurrentY() - 20, 515.28, 22, 0.8, 0.85, 0.8, true);

      doc.addText(`Sesion #${wIdx + 1}: ${w.routineName} - ${w.routineDayName || 'General'}`, 48, doc.getCurrentY() - 14, {
        fontSize: 9,
        font: 'F2',
        r: 0.1,
        g: 0.1,
        b: 0.1,
      });

      doc.addText(statusLabel, 360, doc.getCurrentY() - 14, {
        fontSize: 8,
        font: 'F2',
        r: isCompleted ? 0.12 : 0.75,
        g: isCompleted ? 0.44 : 0.45,
        b: isCompleted ? 0.28 : 0.1,
      });

      doc.moveDown(26);

      // Session Metrics Sub-strip
      const sessionTonnageStr = `${(w.totalTonnageKg || 0).toLocaleString()} kg`;
      const setsCountStr = `${w.totalCompletedSets || 0} series / ${w.totalReps || 0} reps`;
      const rpeStr = w.sessionRpe ? `RPE ${w.sessionRpe.toFixed(1)}` : 'RPE: -';
      doc.addText(`Fecha: ${startDate}  |  Duracion: ${durMin} min  |  Tonelaje: ${sessionTonnageStr}  |  ${setsCountStr}  |  ${rpeStr}`, 48, doc.getCurrentY() - 10, {
        fontSize: 7.5,
        font: 'F1',
        r: 0.35,
        g: 0.35,
        b: 0.35,
      });

      if (w.notes) {
        doc.moveDown(12);
        doc.addText(`Notas: "${w.notes}"`, 48, doc.getCurrentY() - 10, {
          fontSize: 7.5,
          font: 'F3',
          r: 0.4,
          g: 0.4,
          b: 0.4,
        });
      }

      doc.moveDown(16);

      // Exercise breakdown
      if (w.exercisesSnapshot && w.exercisesSnapshot.length > 0) {
        w.exercisesSnapshot.forEach(ex => {
          doc.ensureSpace(35);
          doc.addText(`* ${ex.exerciseName} (${ex.muscleGroup || 'General'})`, 55, doc.getCurrentY() - 8, {
            fontSize: 8,
            font: 'F2',
            r: 0.2,
            g: 0.2,
            b: 0.2,
          });
          doc.moveDown(12);

          const completedSets = ex.sets.filter(s => s.completed);
          if (completedSets.length === 0) {
            doc.addText('Sin series completadas en este ejercicio.', 65, doc.getCurrentY() - 8, {
              fontSize: 7,
              font: 'F3',
              r: 0.5,
              g: 0.5,
              b: 0.5,
            });
            doc.moveDown(10);
          } else {
            completedSets.forEach(s => {
              doc.ensureSpace(14);
              const isWarmup = s.type === 'warmup';
              const setTypeTag = isWarmup ? '[Aprox.]' : s.type === 'dropset' ? '[Drop]' : '[Efectiva]';
              const epleyVal = s.estimated1RM > 0 ? `${s.estimated1RM.toFixed(1)} kg` : (s.weightKg > 0 && s.reps > 0 ? `${calculateEpley1RM(s.weightKg, s.reps).value.toFixed(1)} kg` : '-');
              const rirText = s.rir !== undefined && s.rir !== null ? `RIR ${s.rir}` : 'RIR -';

              const setLine = `Serie ${s.setNumber} ${setTypeTag}: ${s.weightKg} kg x ${s.reps} reps  @ ${rirText}  |  1RM est: ${epleyVal}`;
              doc.addText(setLine, 65, doc.getCurrentY() - 8, {
                fontSize: 7,
                font: isWarmup ? 'F3' : 'F1',
                r: isWarmup ? 0.5 : 0.15,
                g: isWarmup ? 0.5 : 0.15,
                b: isWarmup ? 0.5 : 0.15,
              });
              doc.moveDown(10);
            });
          }
        });
      }

      doc.moveDown(10);
      doc.drawLine(40, doc.getCurrentY(), 555.28, doc.getCurrentY(), 0.9, 0.9, 0.9, 0.5);
      doc.moveDown(12);
    });
  }

  const pdfBytes = doc.buildBytes();
  return new Blob([pdfBytes as unknown as BlobPart], { type: 'application/pdf' });
}

/**
 * Triggers a browser download of PDF Blob with object URL revocation.
 */
export function downloadPdfFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 300);
}

/**
 * Generates formatted HTML for high-resolution print or browser PDF preview.
 */
export function generatePrintableHtml(
  summary: ExportSummaryStats,
  workouts: ExecutedWorkout[],
  personalRecords: ExportPersonalRecord[],
  userName: string = 'Atleta Vigor'
): string {
  const prRows = personalRecords.slice(0, 8).map(pr => `
    <tr>
      <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; font-weight: 600;">${pr.exerciseName}</td>
      <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; text-align: right;">${pr.weightKg} kg x ${pr.reps} reps</td>
      <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; text-align: center;">${pr.rir !== null ? 'RIR ' + pr.rir : '—'}</td>
      <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #15803d; font-weight: 700;">${pr.estimated1RM.toFixed(1)} kg</td>
      <td style="padding: 6px 10px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #6b7280;">${pr.date ? new Date(pr.date).toLocaleDateString('es-ES') : '—'}</td>
    </tr>
  `).join('');

  const workoutCards = workouts.map((w, idx) => {
    const isCompleted = w.status === 'completed';
    const isAbandoned = w.status === 'abandoned';
    const statusBadge = isCompleted
      ? '<span style="background: #dcfce7; color: #15803d; padding: 2px 8px; border-radius: 9999px; font-weight: 700; font-size: 11px;">COMPLETADA</span>'
      : isAbandoned
      ? '<span style="background: #fef3c7; color: #b45309; padding: 2px 8px; border-radius: 9999px; font-weight: 700; font-size: 11px;">CANCELADA</span>'
      : '<span style="background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 9999px; font-weight: 700; font-size: 11px;">EN CURSO</span>';

    const exercisesHtml = (w.exercisesSnapshot || []).map(ex => {
      const setsRows = (ex.sets || []).filter(s => s.completed).map(s => `
        <div style="display: flex; justify-content: space-between; padding: 4px 8px; font-size: 11px; background: #f9fafb; margin-bottom: 2px; border-radius: 4px;">
          <span><strong>Serie ${s.setNumber}</strong> ${s.type === 'warmup' ? '<em style="color: #6b7280;">(Aprox.)</em>' : ''}</span>
          <span>${s.weightKg} kg × ${s.reps} reps</span>
          <span style="color: #4b5563;">@ RIR ${s.rir ?? '—'}</span>
          <span style="font-weight: 600; color: #15803d;">1RM: ${s.estimated1RM > 0 ? s.estimated1RM.toFixed(1) + ' kg' : '—'}</span>
        </div>
      `).join('');

      return `
        <div style="margin-top: 8px;">
          <div style="font-size: 12px; font-weight: 700; color: #1f2937; margin-bottom: 3px;">• ${ex.exerciseName}</div>
          ${setsRows || '<span style="font-size: 11px; color: #9ca3af; font-style: italic;">Sin series completadas</span>'}
        </div>
      `;
    }).join('');

    return `
      <div style="page-break-inside: avoid; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 14px; background: #ffffff;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f3f4f6; padding-bottom: 8px; margin-bottom: 8px;">
          <div>
            <div style="font-size: 14px; font-weight: 800; color: #111827;">Sesión #${idx + 1}: ${w.routineName}</div>
            <div style="font-size: 11px; color: #6b7280;">${w.routineDayName || 'Sesión General'} • ${w.startedAt ? new Date(w.startedAt).toLocaleString('es-ES') : '—'}</div>
          </div>
          <div>${statusBadge}</div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; font-size: 11px; background: #f9fafb; padding: 6px 10px; border-radius: 6px; margin-bottom: 8px;">
          <div><strong style="color: #6b7280;">Tonelaje:</strong> ${(w.totalTonnageKg || 0).toLocaleString()} kg</div>
          <div><strong style="color: #6b7280;">Series:</strong> ${w.totalCompletedSets || 0} comp.</div>
          <div><strong style="color: #6b7280;">Tiempo:</strong> ${Math.round((w.durationSeconds || 0) / 60)} min</div>
          <div><strong style="color: #6b7280;">RPE:</strong> ${w.sessionRpe ? w.sessionRpe.toFixed(1) : '—'}</div>
        </div>
        ${w.notes ? `<div style="font-size: 11px; color: #4b5563; font-style: italic; margin-bottom: 8px; background: #fdf6b2; padding: 4px 8px; border-radius: 4px;">"${w.notes}"</div>` : ''}
        ${exercisesHtml}
      </div>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <title>VigorCore — Informe de Entrenamiento</title>
      <style>
        @page { size: A4; margin: 15mm; }
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111827; margin: 0; padding: 15px; font-size: 12px; }
        .header { background: #15803d; color: white; padding: 14px 18px; border-radius: 8px; margin-bottom: 16px; }
        .grid-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 16px; }
        .kpi-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; background: #f9fafb; text-align: center; }
        .kpi-title { font-size: 10px; text-transform: uppercase; color: #6b7280; font-weight: 700; }
        .kpi-value { font-size: 18px; font-weight: 800; color: #111827; margin: 4px 0; }
        table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 16px; }
        th { background: #f3f4f6; color: #374151; padding: 6px 10px; text-align: left; font-size: 10px; text-transform: uppercase; border-bottom: 2px solid #e5e7eb; }
        @media print {
          body { padding: 0; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="no-print" style="margin-bottom: 15px; display: flex; justify-content: flex-end; gap: 8px;">
        <button onclick="window.print()" style="background: #15803d; color: white; border: none; padding: 8px 16px; border-radius: 6px; font-weight: bold; cursor: pointer;">Imprimir / Guardar como PDF</button>
        <button onclick="window.close()" style="background: #e5e7eb; color: #374151; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Cerrar</button>
      </div>

      <div class="header">
        <h1 style="margin: 0; font-size: 18px; font-weight: 800;">VIGORCORE • INFORME TÉCNICO DE ENTRENAMIENTO</h1>
        <p style="margin: 4px 0 0; font-size: 11px; opacity: 0.9;">Atleta: ${userName} • Período: ${summary.periodLabel} • Generado: ${new Date().toLocaleString('es-ES')}</p>
      </div>

      <div class="grid-kpis">
        <div class="kpi-card">
          <div class="kpi-title">Sesiones</div>
          <div class="kpi-value">${summary.totalSessions}</div>
          <div style="font-size: 10px; color: #6b7280;">${summary.completedSessions} comp / ${summary.abandonedSessions} canc</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Tonelaje Efectivo</div>
          <div class="kpi-value" style="color: #15803d;">${summary.totalTonnageKg.toLocaleString()} kg</div>
          <div style="font-size: 10px; color: #6b7280;">Calentamiento excluido</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">Series Efectivas</div>
          <div class="kpi-value">${summary.totalCompletedSets}</div>
          <div style="font-size: 10px; color: #6b7280;">${summary.totalReps} repeticiones</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-title">RIR Medio / Duración</div>
          <div class="kpi-value">${summary.averageRir !== null ? summary.averageRir.toFixed(1) : '—'}</div>
          <div style="font-size: 10px; color: #6b7280;">~${summary.averageDurationMinutes} min / sesión</div>
        </div>
      </div>

      ${personalRecords.length > 0 ? `
        <h2 style="font-size: 13px; font-weight: 800; color: #15803d; margin: 16px 0 8px; border-bottom: 2px solid #15803d; padding-bottom: 4px;">RÉCORDS PERSONALES (1RM ESTIMACIÓN EPLEY)</h2>
        <table>
          <thead>
            <tr>
              <th>Ejercicio</th>
              <th style="text-align: right;">Carga Lograda</th>
              <th style="text-align: center;">RIR</th>
              <th style="text-align: right;">1RM Estimado</th>
              <th style="text-align: right;">Fecha</th>
            </tr>
          </thead>
          <tbody>${prRows}</tbody>
        </table>
      ` : ''}

      <h2 style="font-size: 13px; font-weight: 800; color: #15803d; margin: 20px 0 8px; border-bottom: 2px solid #15803d; padding-bottom: 4px;">HISTORIAL DETALLADO DE SESIONES</h2>
      ${workoutCards}

      <div style="text-align: center; margin-top: 24px; padding-top: 12px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #9ca3af;">
        VigorCore Sports Performance Engine • Generado localmente en el navegador • Datos confidenciales de entrenamiento
      </div>
    </body>
    </html>
  `;
}
