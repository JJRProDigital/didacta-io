/**
 * Tests de `IntegrationsService` (API de lectura para integradores externos).
 *
 * Lo que se protege aquí es lo que un sitio de fuera —un WordPress pintando su
 * ficha de curso— puede romper o filtrar:
 *  - El `content` de las lecciones NUNCA sale. Ni siquiera se le pide a Postgres.
 *  - "Continuar" apunta a la primera lección sin completar, y a la primera del
 *    curso cuando ya están todas.
 *  - PAUSED (impago) no es lo mismo que no haber comprado nunca: `enrolled` sí,
 *    `hasAccess` no. Confundirlos manda a un alumno de pago a la página de venta.
 *  - Un fallo de mod.billing degrada la ficha a "sin precios", no la tumba.
 */

import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { IntegrationsService } from '../src/integrations/integrations.service';

const TENANT_ID = 't1';
const WEB_BASE = 'https://academia.example';
const COURSE_ID = '11111111-1111-1111-1111-111111111111';

type Lesson = { id: string; title: string };

function makeHarness(
  opts: {
    course?: Record<string, unknown> | null;
    user?: { id: string; name: string | null } | null;
    instructor?: { name: string | null; jobTitle: string | null; avatarUrl: string | null } | null;
    enrollments?: Array<Record<string, unknown>>;
    courseRows?: Array<{ id: string; title: string; slug: string }>;
    modules?: Array<{ id: string; title: string; lessons: Lesson[] }>;
    completedLessonIds?: string[];
    defaultTemplate?: { id: string } | null;
    offerThrows?: boolean;
    availability?: Record<string, { available: boolean }>;
    availabilityThrows?: boolean;
  } = {},
) {
  const findFirstCourse = vi.fn().mockResolvedValue(opts.course ?? null);
  const findManyCourses = vi.fn().mockResolvedValue(opts.courseRows ?? []);

  const prisma = {
    modCoursesCourse: {
      findFirst: findFirstCourse,
      findMany: findManyCourses,
    },
    modCoursesModule: {
      findMany: vi.fn().mockResolvedValue(opts.modules ?? []),
    },
    modLearningEnrollment: {
      findMany: vi.fn().mockResolvedValue(opts.enrollments ?? []),
    },
    modLearningProgress: {
      findMany: vi
        .fn()
        .mockResolvedValue((opts.completedLessonIds ?? []).map((lessonId) => ({ lessonId }))),
    },
    modCertificatesTemplate: {
      findFirst: vi.fn().mockResolvedValue(opts.defaultTemplate ?? null),
    },
    user: {
      // El servicio usa `user.findFirst` para dos cosas distintas: resolver al
      // alumno por email y resolver al formador por id. Se distinguen por el
      // `where`, igual que en producción.
      findFirst: vi.fn(async (args: { where: Record<string, unknown> }) =>
        'id' in args.where ? (opts.instructor ?? null) : (opts.user ?? null),
      ),
    },
  } as never;

  const getCourseOffer = vi.fn(async () =>
    opts.offerThrows
      ? Promise.reject(new Error('stripe no configurado'))
      : { forSale: true, options: [{ id: 'opt-1', name: '', unitAmount: 12997 }] },
  );
  const getCourseAvailability = vi.fn(async () =>
    opts.availabilityThrows
      ? Promise.reject(new Error('drip caído'))
      : { drip: opts.availability !== undefined, lessons: opts.availability ?? {} },
  );
  const registry = {
    getBillingService: () => ({ getCourseOffer }),
    getLearningService: () => ({ getCourseAvailability }),
  } as never;
  const loggerWarn = vi.fn();
  const logger = { warn: loggerWarn, log: vi.fn() } as never;

  return {
    service: new IntegrationsService(prisma, registry, logger),
    findFirstCourse,
    findManyCourses,
    getCourseOffer,
    getCourseAvailability,
    loggerWarn,
  };
}

/** Curso mínimo con un módulo de dos lecciones, tal y como lo devuelve Prisma. */
function courseFixture(over: Record<string, unknown> = {}) {
  return {
    id: COURSE_ID,
    slug: 'curso-de-claude-code',
    title: 'Curso de Claude Code',
    description: 'De cero a experto.',
    status: 'PUBLISHED',
    category: 'IA',
    thumbnailUrl: 'https://cdn/x.jpg',
    featuredVideoUrl: null,
    language: 'es-ES',
    estimatedMinutes: 600,
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    externalSource: 'learndash',
    externalId: '1234',
    externalPurchaseUrl: null,
    certificateTemplateId: null,
    createdById: 'formador-1',
    modules: [
      {
        id: 'mod-1',
        title: 'Introducción',
        description: null,
        position: 1,
        lessons: [
          {
            id: 'les-1',
            title: 'Qué es Claude Code',
            type: 'VIDEO',
            position: 1,
            durationMinutes: 12,
            publishAt: null,
          },
          {
            id: 'les-2',
            title: 'Instalación',
            type: 'VIDEO',
            position: 2,
            durationMinutes: 8,
            publishAt: new Date('2099-01-01T00:00:00Z'),
          },
        ],
      },
    ],
    ...over,
  };
}

describe('IntegrationsService · ficha de curso', () => {
  it('no le pide el contenido de las lecciones a la base de datos', async () => {
    const h = makeHarness({ course: courseFixture() });
    await h.service.getCourseDetail(TENANT_ID, COURSE_ID);

    const args = h.findFirstCourse.mock.calls[0]![0];
    const lessonSelect = args.select.modules.select.lessons.select;
    expect(lessonSelect).not.toHaveProperty('content');
    // Y el `where` sigue excluyendo borrados en los tres niveles.
    expect(args.where.deletedAt).toBeNull();
    expect(args.select.modules.where.deletedAt).toBeNull();
    expect(args.select.modules.select.lessons.where.deletedAt).toBeNull();
  });

  it('cuenta módulos, clases y minutos reales, y marca las lecciones programadas', async () => {
    const h = makeHarness({ course: courseFixture() });
    const detail = await h.service.getCourseDetail(TENANT_ID, COURSE_ID);

    expect(detail.totals).toEqual({ modules: 1, lessons: 2, minutes: 20 });
    // `estimatedMinutes` es lo que anunció el formador y se conserva aparte:
    // no tiene por qué cuadrar con la suma real.
    expect(detail.estimatedMinutes).toBe(600);
    expect(detail.modules[0]!.lessons[0]!.scheduled).toBe(false);
    expect(detail.modules[0]!.lessons[1]!.scheduled).toBe(true);
  });

  it('conserva el origen de la importación para que el integrador mapee solo', async () => {
    const h = makeHarness({ course: courseFixture() });
    const detail = await h.service.getCourseDetail(TENANT_ID, COURSE_ID);
    expect(detail.externalSource).toBe('learndash');
    expect(detail.externalId).toBe('1234');
  });

  it('hay certificado si el tenant tiene plantilla por defecto aunque el curso no elija', async () => {
    const conDefault = makeHarness({
      course: courseFixture(),
      defaultTemplate: { id: 'tpl-1' },
    });
    expect((await conDefault.service.getCourseDetail(TENANT_ID, COURSE_ID)).hasCertificate).toBe(
      true,
    );

    const sinNada = makeHarness({ course: courseFixture(), defaultTemplate: null });
    expect((await sinNada.service.getCourseDetail(TENANT_ID, COURSE_ID)).hasCertificate).toBe(
      false,
    );
  });

  it('si mod.billing falla, sirve la ficha sin precios en vez de romperla', async () => {
    const h = makeHarness({ course: courseFixture(), offerThrows: true });
    const detail = await h.service.getCourseDetail(TENANT_ID, COURSE_ID);

    expect(detail.offer).toEqual({ forSale: false, options: [] });
    expect(detail.title).toBe('Curso de Claude Code');
    expect(h.loggerWarn).toHaveBeenCalled();
  });

  it('404 con código estable cuando el curso no existe en el tenant', async () => {
    const h = makeHarness({ course: null });
    await expect(h.service.getCourseDetail(TENANT_ID, COURSE_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('IntegrationsService · estado del alumno', () => {
  const modules = [
    {
      id: 'mod-1',
      title: 'Introducción',
      lessons: [
        { id: 'les-1', title: 'Uno' },
        { id: 'les-2', title: 'Dos' },
        { id: 'les-3', title: 'Tres' },
      ],
    },
  ];
  const activeEnrollment = {
    id: 'enr-1',
    courseId: COURSE_ID,
    status: 'ACTIVE',
    source: 'API',
    progressPercent: 33,
    enrolledAt: new Date('2026-02-01T00:00:00Z'),
    completedAt: null,
  };

  it('devuelve known:false si el email no es de nadie del tenant', async () => {
    const h = makeHarness({ user: null });
    const state = await h.service.getLearnerState(TENANT_ID, 'nadie@x.com', COURSE_ID, WEB_BASE);

    expect(state).toEqual({
      known: false,
      userId: null,
      name: null,
      enrollments: [],
      course: null,
    });
  });

  it('continúa por la primera lección sin completar, con URL absoluta a la clase', async () => {
    const h = makeHarness({
      user: { id: 'u1', name: 'Ana' },
      enrollments: [activeEnrollment],
      courseRows: [{ id: COURSE_ID, title: 'Curso de Claude Code', slug: 'curso' }],
      modules,
      completedLessonIds: ['les-1'],
    });
    const state = await h.service.getLearnerState(TENANT_ID, 'ana@x.com', COURSE_ID, WEB_BASE);

    expect(state.known).toBe(true);
    expect(state.course?.nextLesson).toEqual({
      id: 'les-2',
      title: 'Dos',
      moduleId: 'mod-1',
      moduleTitle: 'Introducción',
      url: `${WEB_BASE}/clase/les-2`,
    });
    expect(state.course?.lessonsCompleted).toBe(1);
    expect(state.course?.lessonsTotal).toBe(3);
    expect(state.enrollments[0]!.courseTitle).toBe('Curso de Claude Code');
  });

  it('con el curso terminado, continúa por la primera lección (repaso), no por null', async () => {
    const h = makeHarness({
      user: { id: 'u1', name: 'Ana' },
      enrollments: [{ ...activeEnrollment, status: 'COMPLETED', progressPercent: 100 }],
      modules,
      completedLessonIds: ['les-1', 'les-2', 'les-3'],
    });
    const state = await h.service.getLearnerState(TENANT_ID, 'ana@x.com', COURSE_ID, WEB_BASE);

    expect(state.course?.nextLesson?.id).toBe('les-1');
    expect(state.course?.hasAccess).toBe(true);
  });

  it('PAUSED es un alumno suspendido, no un visitante: enrolled sí, hasAccess no', async () => {
    const h = makeHarness({
      user: { id: 'u1', name: 'Ana' },
      enrollments: [{ ...activeEnrollment, status: 'PAUSED' }],
      modules,
      completedLessonIds: ['les-1'],
    });
    const state = await h.service.getLearnerState(TENANT_ID, 'ana@x.com', COURSE_ID, WEB_BASE);

    expect(state.course?.enrolled).toBe(true);
    expect(state.course?.hasAccess).toBe(false);
    expect(state.course?.status).toBe('PAUSED');
    // El progreso NO se pierde durante la suspensión.
    expect(state.course?.lessonsCompleted).toBe(1);
  });

  it('CANCELLED no cuenta como matriculado', async () => {
    const h = makeHarness({
      user: { id: 'u1', name: 'Ana' },
      enrollments: [{ ...activeEnrollment, status: 'CANCELLED' }],
      modules,
    });
    const state = await h.service.getLearnerState(TENANT_ID, 'ana@x.com', COURSE_ID, WEB_BASE);

    expect(state.course?.enrolled).toBe(false);
    expect(state.course?.hasAccess).toBe(false);
  });

  it('usuario conocido sin matrícula en ESE curso: temario contado, progreso a cero', async () => {
    const h = makeHarness({
      user: { id: 'u1', name: 'Ana' },
      enrollments: [{ ...activeEnrollment, courseId: 'otro-curso' }],
      modules,
    });
    const state = await h.service.getLearnerState(TENANT_ID, 'ana@x.com', COURSE_ID, WEB_BASE);

    expect(state.known).toBe(true);
    expect(state.course?.enrolled).toBe(false);
    expect(state.course?.lessonsTotal).toBe(3);
    expect(state.course?.progressPercent).toBe(0);
    expect(state.course?.completedLessonIds).toEqual([]);
  });

  it('sin courseId devuelve solo el resumen de matrículas', async () => {
    const h = makeHarness({
      user: { id: 'u1', name: 'Ana' },
      enrollments: [activeEnrollment],
      courseRows: [{ id: COURSE_ID, title: 'Curso de Claude Code', slug: 'curso' }],
    });
    const state = await h.service.getLearnerState(TENANT_ID, 'ana@x.com', undefined, WEB_BASE);

    expect(state.course).toBeNull();
    expect(state.enrollments).toHaveLength(1);
    expect(state.enrollments[0]!.source).toBe('API');
  });

  it('no propone una lección que el drip aún no ha liberado', async () => {
    const h = makeHarness({
      user: { id: 'u1', name: 'Ana' },
      enrollments: [activeEnrollment],
      modules,
      completedLessonIds: ['les-1'],
      // La 2 está cerrada por drip; la 3 abierta.
      availability: {
        'les-1': { available: true },
        'les-2': { available: false },
        'les-3': { available: true },
      },
    });
    const state = await h.service.getLearnerState(TENANT_ID, 'ana@x.com', COURSE_ID, WEB_BASE);
    expect(state.course?.nextLesson?.id).toBe('les-3');
  });

  it('si el drip no ha liberado nada, no inventa un enlace: nextLesson es null', async () => {
    const h = makeHarness({
      user: { id: 'u1', name: 'Ana' },
      enrollments: [activeEnrollment],
      modules,
      availability: {
        'les-1': { available: false },
        'les-2': { available: false },
        'les-3': { available: false },
      },
    });
    const state = await h.service.getLearnerState(TENANT_ID, 'ana@x.com', COURSE_ID, WEB_BASE);
    expect(state.course?.nextLesson).toBeNull();
    // Sigue siendo alumno con acceso: el curso simplemente no ha empezado.
    expect(state.course?.hasAccess).toBe(true);
    expect(state.course?.lessonsTotal).toBe(3);
  });

  it('no consulta el drip de quien no tiene acceso', async () => {
    const h = makeHarness({
      user: { id: 'u1', name: 'Ana' },
      enrollments: [{ ...activeEnrollment, status: 'PAUSED' }],
      modules,
    });
    await h.service.getLearnerState(TENANT_ID, 'ana@x.com', COURSE_ID, WEB_BASE);
    expect(h.getCourseAvailability).not.toHaveBeenCalled();
  });

  it('si el drip falla, asume todo liberado en vez de tumbar la ficha', async () => {
    const h = makeHarness({
      user: { id: 'u1', name: 'Ana' },
      enrollments: [activeEnrollment],
      modules,
      availabilityThrows: true,
    });
    const state = await h.service.getLearnerState(TENANT_ID, 'ana@x.com', COURSE_ID, WEB_BASE);
    expect(state.course?.nextLesson?.id).toBe('les-1');
    expect(h.loggerWarn).toHaveBeenCalled();
  });

  it('no duplica la barra al componer la URL de la clase', async () => {
    const h = makeHarness({
      user: { id: 'u1', name: 'Ana' },
      enrollments: [activeEnrollment],
      modules,
    });
    const state = await h.service.getLearnerState(
      TENANT_ID,
      'ana@x.com',
      COURSE_ID,
      `${WEB_BASE}/`,
    );
    expect(state.course?.nextLesson?.url).toBe(`${WEB_BASE}/clase/les-1`);
  });
});

describe('IntegrationsService · catálogo para mapear', () => {
  it('traslada los filtros y omite los que no vienen', async () => {
    const h = makeHarness({ courseRows: [] });
    await h.service.listCourses(TENANT_ID, {
      externalId: '1234',
      externalSource: 'learndash',
    });

    const where = h.findManyCourses.mock.calls[0]![0].where;
    expect(where).toMatchObject({
      tenantId: TENANT_ID,
      deletedAt: null,
      externalId: '1234',
      externalSource: 'learndash',
    });
    expect(where).not.toHaveProperty('slug');
    expect(where).not.toHaveProperty('status');
  });
});
