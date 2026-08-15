/**
 * Copyright (c) VA360 LABS S.L.
 * SPDX-License-Identifier: LicenseRef-Didacta-Sustainable-Use
 */

import type { DidactaModule, ModuleContext } from '@didacta/core-kernel';
import { manifest } from './manifest.js';

export { manifest };
export { ThemingService } from './theming.service.js';
export {
  ALLOWED_BODY_FONTS,
  ALLOWED_DISPLAY_FONTS,
  ALLOWED_FAVICON_MIME_TYPES,
  ALLOWED_LOGO_MIME_TYPES,
  DEFAULT_LOGO_DISPLAY_MODE,
  DEFAULT_THEME,
  LOGO_DISPLAY_MODES,
  MAX_CUSTOM_CSS_BYTES,
  MAX_FAVICON_BYTES,
  MAX_FOOTER_HTML_BYTES,
  MAX_LOGO_BYTES,
  MAX_SIGNIN_HEADLINE_CHARS,
  MAX_SIGNIN_SUBHEADLINE_CHARS,
  updateThemeSchema,
  uploadFaviconSchema,
  uploadLogoSchema,
  type BodyFont,
  type DisplayFont,
  type LogoDisplayMode,
  type ThemeSnapshot,
  type UpdateThemeDto,
  type UploadFaviconDto,
  type UploadLogoDto,
} from './dto.js';
export {
  CustomCssTooLargeError,
  CustomCssUnsafeError,
  EmptyFaviconError,
  EmptyLogoError,
  FaviconNotFoundError,
  FaviconTooLargeError,
  FooterHtmlTooLargeError,
  InvalidHueError,
  InvalidSaturationError,
  InvalidUrlError,
  LogoNotFoundError,
  LogoTooLargeError,
  SigninCopyTooLongError,
  ThemingError,
  UnsupportedFaviconTypeError,
  UnsupportedFontError,
  UnsupportedLogoTypeError,
} from './errors.js';

export const themingModule: DidactaModule = {
  manifest,
  async onRegister(ctx: ModuleContext) {
    ctx.logger.info('mod.theming: onRegister', { name: manifest.name });
  },
  async onEnable(tenantId: string, ctx: ModuleContext) {
    ctx.logger.info('mod.theming: onEnable', { tenantId });
  },
  async onDisable(tenantId: string, ctx: ModuleContext) {
    ctx.logger.info('mod.theming: onDisable', { tenantId });
  },
  async onUninstall(tenantId: string, ctx: ModuleContext) {
    ctx.logger.info('mod.theming: onUninstall', { tenantId });
  },
};
