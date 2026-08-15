'use client';

/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

/**
 * Campo de color reutilizable: fila de muestras sugeridas + input hex editable.
 *
 * Nace de cuatro copias a mano del mismo patrón (espacios, tags, categorías de
 * curso y el modal de crear espacio, que además no tenía input hex). El campo
 * NO trae `<Label>`: cada página pone el suyo con su catálogo i18n, y por lo
 * mismo el aria-label de las muestras entra por props.
 *
 * El input es deliberadamente «crudo»: el valor viaja tal cual se teclea y son
 * `pattern` + `required` quienes lo validan al enviar el form (los backends
 * revalidan con su propio regex hex). Así una edición a medias no pelea con el
 * estado del formulario.
 */

import { Input } from '@/components/ui/input';

export const SUGGESTED_COLORS = [
  '#1E5AA8',
  '#18B5A8',
  '#0D1B2A',
  '#2E7DCE',
  '#16A34A',
  '#F59E0B',
  '#FF6F61',
  '#7C3AED',
] as const;

export interface ColorFieldProps {
  /** id del input hex, para asociar el `<Label htmlFor>` de la página. */
  id?: string;
  /** Valor crudo del formulario (puede estar a medio teclear). */
  value: string;
  onChange: (color: string) => void;
  swatches?: readonly string[];
  /** aria-label de cada muestra; pasa aquí tu key i18n existente. */
  swatchAriaLabel: (color: string) => string;
  required?: boolean;
}

export function ColorField({
  id,
  value,
  onChange,
  swatches = SUGGESTED_COLORS,
  swatchAriaLabel,
  required = true,
}: ColorFieldProps): React.JSX.Element {
  const seleccionado = value.trim().toUpperCase();
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {swatches.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            aria-label={swatchAriaLabel(c)}
            aria-pressed={seleccionado === c.toUpperCase()}
            className={
              seleccionado === c.toUpperCase()
                ? 'h-8 w-8 rounded-md ring-2 ring-brand-500 ring-offset-2 ring-offset-bg'
                : 'h-8 w-8 rounded-md ring-1 ring-border'
            }
            style={{ backgroundColor: c }}
          />
        ))}
      </div>
      <Input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        pattern="^#[0-9a-fA-F]{6}$"
        required={required}
        placeholder="#1E5AA8"
        className="font-mono"
      />
    </div>
  );
}
