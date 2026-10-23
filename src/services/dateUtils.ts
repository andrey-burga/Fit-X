/**
 * Utilidades de fecha y zona horaria local para VigorCore
 *
 * Evita desfasar comidas al día anterior o siguiente por agrupación UTC.
 * Trata las fechas y horas registradas en la hora local del atleta.
 */

/**
 * Extrae la fecha YYYY-MM-DD local de un string ISO o datetime-local.
 * Garantiza que una comida registrada a las 23:30 local no se mueva a mañana por UTC.
 */
export function getLocalDateString(dateTimeStr?: string): string {
  if (!dateTimeStr) return '';
  const trimmed = dateTimeStr.trim();

  // Si ya es formato 'YYYY-MM-DD'
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  // Si contiene separador 'T', ej: '2024-10-24T13:45'
  if (trimmed.includes('T')) {
    const [datePart] = trimmed.split('T');
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      // Si no tiene 'Z' ni offset '+/-', datePart es la fecha local explícita
      if (!trimmed.includes('Z') && !trimmed.slice(10).includes('+') && !trimmed.slice(10).includes('-')) {
        return datePart;
      }
      // Si tiene 'Z' o zona, parseamos con Date local
      const d = new Date(trimmed);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
      }
      return datePart;
    }
  }

  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  return trimmed.slice(0, 10);
}

/**
 * Retorna la fecha de hoy en formato YYYY-MM-DD según la zona horaria del cliente.
 */
export function getTodayLocalDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Formatea una fecha YYYY-MM-DD al español para encabezados y selectores.
 * Ej: 'Hoy, 24 Octubre 2024', 'Ayer, 23 Octubre 2024', 'Jueves, 24 Octubre 2024'
 */
export function formatSpanishDate(dateStr: string): string {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr || 'Fecha no seleccionada';
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  const dateObj = new Date(year, month - 1, day, 12, 0, 0);

  const todayStr = getTodayLocalDateString();
  const yesterdayObj = new Date();
  yesterdayObj.setDate(yesterdayObj.getDate() - 1);
  const yYear = yesterdayObj.getFullYear();
  const yMonth = String(yesterdayObj.getMonth() + 1).padStart(2, '0');
  const yDay = String(yesterdayObj.getDate()).padStart(2, '0');
  const yesterdayStr = `${yYear}-${yMonth}-${yDay}`;

  const daysOfWeek = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const dayOfWeek = daysOfWeek[dateObj.getDay()];
  const monthName = months[dateObj.getMonth()];

  if (dateStr === todayStr) {
    return `Hoy, ${day} ${monthName} ${year}`;
  }
  if (dateStr === yesterdayStr) {
    return `Ayer, ${day} ${monthName} ${year}`;
  }
  return `${dayOfWeek}, ${day} ${monthName} ${year}`;
}

/**
 * Extrae la hora formateada de un string dateTime (ej. '08:15 AM' o '13:30').
 */
export function formatTimeOnly(dateTimeStr?: string): string {
  if (!dateTimeStr) return '';
  if (dateTimeStr.includes('T')) {
    const timePart = dateTimeStr.split('T')[1]?.slice(0, 5);
    if (timePart) {
      const [h, m] = timePart.split(':').map(Number);
      if (!isNaN(h) && !isNaN(m)) {
        const period = h >= 12 ? 'PM' : 'AM';
        const displayH = h % 12 === 0 ? 12 : h % 12;
        return `${String(displayH).padStart(2, '0')}:${String(m).padStart(2, '0')} ${period}`;
      }
      return timePart;
    }
  }
  return '';
}

export interface DayBucket {
  dateStr: string; // 'YYYY-MM-DD'
  dayShort: string; // 'Lun', 'Mar', etc.
  dateShort: string; // '24/10'
  isCurrentDay: boolean;
}

/**
 * Genera el rango de días para la visualización del gráfico semanal o quincenal.
 * Centrado en la semana del `referenceDateStr` (Lunes a Domingo) o los últimos 14 días.
 */
export function getChartDayBuckets(referenceDateStr: string, range: 'week' | '14d'): DayBucket[] {
  const base = getLocalDateString(referenceDateStr) || getTodayLocalDateString();
  const [year, month, day] = base.split('-').map(Number);
  const refDate = new Date(year, month - 1, day, 12, 0, 0);

  const daysOfWeekShort = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  const buckets: DayBucket[] = [];

  if (range === 'week') {
    // Semana natural (Lunes a Domingo)
    const dayOfWeek = refDate.getDay(); // 0 = Dom, 1 = Lun...
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(refDate);
    monday.setDate(refDate.getDate() + diffToMonday);

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);

      const dYear = d.getFullYear();
      const dMonth = String(d.getMonth() + 1).padStart(2, '0');
      const dDay = String(d.getDate()).padStart(2, '0');
      const dateStr = `${dYear}-${dMonth}-${dDay}`;

      buckets.push({
        dateStr,
        dayShort: daysOfWeekShort[d.getDay()],
        dateShort: `${dDay}/${dMonth}`,
        isCurrentDay: dateStr === base,
      });
    }
  } else {
    // 14 días terminando en el domingo de la semana de referencia (o los 14 días hasta refDate)
    const dayOfWeek = refDate.getDay();
    const diffToSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
    const sunday = new Date(refDate);
    sunday.setDate(refDate.getDate() + diffToSunday);

    for (let i = 13; i >= 0; i--) {
      const d = new Date(sunday);
      d.setDate(sunday.getDate() - i);

      const dYear = d.getFullYear();
      const dMonth = String(d.getMonth() + 1).padStart(2, '0');
      const dDay = String(d.getDate()).padStart(2, '0');
      const dateStr = `${dYear}-${dMonth}-${dDay}`;

      buckets.push({
        dateStr,
        dayShort: daysOfWeekShort[d.getDay()],
        dateShort: `${dDay}/${dMonth}`,
        isCurrentDay: dateStr === base,
      });
    }
  }

  return buckets;
}

/**
 * Obtiene el número de semana ISO en el año.
 */
export function getIsoWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export interface WeekRangeInfo {
  weekStart: string; // 'YYYY-MM-DD' (Lunes)
  weekEnd: string;   // 'YYYY-MM-DD' (Domingo)
  weekNumber: number;
  year: number;
  label: string; // 'Semana 43 (21 Oct - 27 Oct 2024)'
}

/**
 * Obtiene el inicio (Lunes) y fin (Domingo) de la semana correspondiente a una fecha dada.
 */
export function getWeekStartEnd(referenceDateStr?: string): WeekRangeInfo {
  const base = getLocalDateString(referenceDateStr) || getTodayLocalDateString();
  const [year, month, day] = base.split('-').map(Number);
  const refDate = new Date(year, month - 1, day, 12, 0, 0);

  const dayOfWeek = refDate.getDay(); // 0 = Dom, 1 = Lun...
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(refDate);
  monday.setDate(refDate.getDate() + diffToMonday);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const mYear = monday.getFullYear();
  const mMonth = String(monday.getMonth() + 1).padStart(2, '0');
  const mDay = String(monday.getDate()).padStart(2, '0');
  const weekStart = `${mYear}-${mMonth}-${mDay}`;

  const sYear = sunday.getFullYear();
  const sMonth = String(sunday.getMonth() + 1).padStart(2, '0');
  const sDay = String(sunday.getDate()).padStart(2, '0');
  const weekEnd = `${sYear}-${sMonth}-${sDay}`;

  const weekNumber = getIsoWeekNumber(monday);

  const monthsShort = [
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
  ];

  const mMonthName = monthsShort[monday.getMonth()];
  const sMonthName = monthsShort[sunday.getMonth()];

  const label = `Semana ${weekNumber} (${mDay} ${mMonthName} - ${sDay} ${sMonthName} ${sYear})`;

  return {
    weekStart,
    weekEnd,
    weekNumber,
    year: mYear,
    label,
  };
}

/**
 * Desplaza una fecha por un número determinado de semanas (+1 para siguiente, -1 para anterior).
 */
export function shiftWeek(referenceDateStr: string, deltaWeeks: number): string {
  const base = getLocalDateString(referenceDateStr) || getTodayLocalDateString();
  const [year, month, day] = base.split('-').map(Number);
  const d = new Date(year, month - 1, day, 12, 0, 0);
  d.setDate(d.getDate() + deltaWeeks * 7);

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dayStr = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayStr}`;
}

export interface WeekDayItem {
  dateStr: string;   // 'YYYY-MM-DD'
  dayShort: string;  // 'Lun'
  dayLabel: string;  // 'Lun 21'
  dayFull: string;   // 'Lunes 21 de Octubre'
  dayOfWeek: number; // 1 = Lun, ..., 7 = Dom
  isToday: boolean;
}

/**
 * Retorna los 7 días (Lunes a Domingo) de la semana a la que pertenece la fecha de referencia.
 */
export function getWeekDays(referenceDateStr?: string): WeekDayItem[] {
  const { weekStart } = getWeekStartEnd(referenceDateStr);
  const [year, month, day] = weekStart.split('-').map(Number);
  const monday = new Date(year, month - 1, day, 12, 0, 0);

  const todayStr = getTodayLocalDateString();
  const daysShort = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const daysFull = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const result: WeekDayItem[] = [];

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);

    const dYear = d.getFullYear();
    const dMonth = String(d.getMonth() + 1).padStart(2, '0');
    const dDay = String(d.getDate()).padStart(2, '0');
    const dateStr = `${dYear}-${dMonth}-${dDay}`;

    const shortName = daysShort[i];
    const fullName = daysFull[i];
    const monthName = months[d.getMonth()];

    result.push({
      dateStr,
      dayShort: shortName,
      dayLabel: `${shortName} ${parseInt(dDay, 10)}`,
      dayFull: `${fullName} ${parseInt(dDay, 10)} de ${monthName}`,
      dayOfWeek: i + 1,
      isToday: dateStr === todayStr,
    });
  }

  return result;
}
