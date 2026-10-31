/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * VigorCore — Unit Conversion & Formatting Service
 * Maintains canonical SI units in database (kg, cm) while providing
 * dynamic presentation in imperial units (lbs, in) across UI views.
 */

import { WeightUnit, HeightUnit } from '../types/auth';

const KG_TO_LBS = 2.20462262185;
const LBS_TO_KG = 0.45359237;
const CM_TO_IN = 0.3937007874;
const IN_TO_CM = 2.54;

/**
 * Convert kilograms to pounds
 */
export function kgToLbs(kg: number): number {
  return Math.round(kg * KG_TO_LBS * 10) / 10;
}

/**
 * Convert pounds to kilograms
 */
export function lbsToKg(lbs: number): number {
  return Math.round(lbs * LBS_TO_KG * 10) / 10;
}

/**
 * Convert centimeters to inches
 */
export function cmToInches(cm: number): number {
  return Math.round(cm * CM_TO_IN * 10) / 10;
}

/**
 * Convert inches to centimeters
 */
export function inchesToCm(inches: number): number {
  return Math.round(inches * IN_TO_CM * 10) / 10;
}

/**
 * Converts user input to canonical storage unit (Kilograms)
 */
export function toCanonicalKg(value: number, unit: WeightUnit): number {
  if (unit === 'lbs') {
    return lbsToKg(value);
  }
  return Math.round(value * 10) / 10;
}

/**
 * Converts user input to canonical storage unit (Centimeters)
 */
export function toCanonicalCm(value: number, unit: HeightUnit): number {
  if (unit === 'in') {
    return inchesToCm(value);
  }
  return Math.round(value * 10) / 10;
}

/**
 * Converts stored canonical kilograms to the preferred unit for display input
 */
export function fromCanonicalKg(kg: number, unit: WeightUnit): number {
  if (unit === 'lbs') {
    return kgToLbs(kg);
  }
  return Math.round(kg * 10) / 10;
}

/**
 * Converts stored canonical centimeters to the preferred unit for display input
 */
export function fromCanonicalCm(cm: number, unit: HeightUnit): number {
  if (unit === 'in') {
    return cmToInches(cm);
  }
  return Math.round(cm * 10) / 10;
}

/**
 * Formats a weight in kilograms to a formatted string according to the preferred unit
 */
export function formatWeight(kg: number, unit: WeightUnit = 'kg'): string {
  if (unit === 'lbs') {
    return `${kgToLbs(kg)} lbs`;
  }
  return `${Math.round(kg * 10) / 10} kg`;
}

/**
 * Formats a height in centimeters to a formatted string according to the preferred unit
 */
export function formatHeight(cm: number, unit: HeightUnit = 'cm'): string {
  if (unit === 'in') {
    const totalInches = Math.round(cm * CM_TO_IN);
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    return `${feet}'${inches}" (${cmToInches(cm)} in)`;
  }
  return `${Math.round(cm)} cm`;
}
