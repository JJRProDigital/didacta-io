import { describe, expect, it } from 'vitest';
import { BRAND_REFERENCE_LIGHTNESS, hexToHsl, hslToHex, normalizeHexColor } from './color';

describe('normalizeHexColor', () => {
  it('canonicaliza a #RRGGBB mayúsculas', () => {
    expect(normalizeHexColor('#1e5aa8')).toBe('#1E5AA8');
    expect(normalizeHexColor('1E5AA8')).toBe('#1E5AA8');
    expect(normalizeHexColor('  #1E5AA8  ')).toBe('#1E5AA8');
  });

  it('expande la forma corta de 3 dígitos', () => {
    expect(normalizeHexColor('#abc')).toBe('#AABBCC');
    expect(normalizeHexColor('f00')).toBe('#FF0000');
  });

  it('null para lo que no es un hex', () => {
    expect(normalizeHexColor('')).toBeNull();
    expect(normalizeHexColor('#12345')).toBeNull();
    expect(normalizeHexColor('#1E5AA')).toBeNull();
    expect(normalizeHexColor('rojo')).toBeNull();
    expect(normalizeHexColor('#GGGGGG')).toBeNull();
  });
});

describe('hexToHsl', () => {
  it('primarios exactos', () => {
    expect(hexToHsl('#FF0000')).toEqual({ h: 0, s: 100, l: 50 });
    expect(hexToHsl('#00FF00')).toEqual({ h: 120, s: 100, l: 50 });
    expect(hexToHsl('#0000FF')).toEqual({ h: 240, s: 100, l: 50 });
  });

  it('el azul didacta (#1E5AA8) cae en el hue 214 con saturación 70', () => {
    expect(hexToHsl('#1E5AA8')).toEqual({ h: 214, s: 70, l: 39 });
  });

  it('grises: saturación 0 y tono 0 por convención', () => {
    expect(hexToHsl('#808080')).toEqual({ h: 0, s: 0, l: 50 });
    expect(hexToHsl('#FFFFFF')).toEqual({ h: 0, s: 0, l: 100 });
    expect(hexToHsl('#000000')).toEqual({ h: 0, s: 0, l: 0 });
  });

  it('null si la entrada no es hex', () => {
    expect(hexToHsl('azul')).toBeNull();
  });
});

describe('hslToHex', () => {
  it('primarios exactos', () => {
    expect(hslToHex(0, 100, 50)).toBe('#FF0000');
    expect(hslToHex(120, 100, 50)).toBe('#00FF00');
    expect(hslToHex(240, 100, 50)).toBe('#0000FF');
  });

  it('round-trip con la luminosidad de referencia de la marca (±1 por redondeo)', () => {
    for (const [h, s] of [
      [214, 70],
      [0, 80],
      [45, 95],
      [292, 40],
      [174, 60],
    ] as const) {
      const back = hexToHsl(hslToHex(h, s, BRAND_REFERENCE_LIGHTNESS));
      expect(back).not.toBeNull();
      expect(Math.abs(back!.h - h)).toBeLessThanOrEqual(1);
      expect(Math.abs(back!.s - s)).toBeLessThanOrEqual(1);
      expect(Math.abs(back!.l - BRAND_REFERENCE_LIGHTNESS)).toBeLessThanOrEqual(1);
    }
  });
});
