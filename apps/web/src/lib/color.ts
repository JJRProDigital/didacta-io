/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

/**
 * Conversión hex ↔ HSL para los campos de color de marca.
 *
 * El tema del tenant NO guarda hex: guarda `brandHue` + `brandSaturation` y la
 * escala `brand-50…900` pone la luminosidad de cada escalón (ver
 * `lib/theming.ts` y la vista previa de `/admin/branding`). Cuando un admin
 * pega el hex de su marca, extraemos tono y saturación y la luminosidad la
 * normaliza la escala — por eso el color exacto puede variar un punto y la UI
 * lo enseña siempre en la vista previa en vivo.
 */

export interface Hsl {
  /** Tono 0–360, redondeado. */
  h: number;
  /** Saturación 0–100, redondeada. */
  s: number;
  /** Luminosidad 0–100, redondeada. */
  l: number;
}

/**
 * Luminosidad del escalón `brand-500`, el «color de marca» de referencia con
 * el que pintan swatches y previews (`hsl(H S% 45%)`). Si cambia la escala en
 * `globals.css` / `/admin/branding`, cambiar aquí a la par.
 */
export const BRAND_REFERENCE_LIGHTNESS = 45;

/**
 * Canonicaliza lo que teclea un humano a `#RRGGBB` mayúsculas: tolera hex sin
 * `#`, forma corta de 3 dígitos y espacios alrededor. Devuelve null si no es
 * un color hex.
 */
export function normalizeHexColor(input: string): string | null {
  const raw = input.trim().replace(/^#/, '');
  const six = /^[0-9a-fA-F]{6}$/.test(raw)
    ? raw
    : /^[0-9a-fA-F]{3}$/.test(raw)
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : null;
  return six ? `#${six.toUpperCase()}` : null;
}

/** Hex → HSL (redondeado a enteros). Acepta lo mismo que `normalizeHexColor`. */
export function hexToHsl(input: string): Hsl | null {
  const hex = normalizeHexColor(input);
  if (!hex) return null;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    // Gris puro: el tono es indefinido; 0 por convención.
    return { h: 0, s: 0, l: Math.round(l * 100) };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h: Math.round(h) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

/** HSL (h 0–360, s/l 0–100) → `#RRGGBB` mayúsculas. */
export function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const a = sn * Math.min(ln, 1 - ln);
  const canal = (n: number): string => {
    const k = (n + h / 30) % 12;
    const value = ln - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${canal(0)}${canal(8)}${canal(4)}`.toUpperCase();
}
