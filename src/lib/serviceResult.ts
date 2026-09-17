/**
 * Shape compartido por todos los `*Service.ts` del repo (auth, shifts,
 * medications, family, caredPersons, contacts, careProfile,
 * shiftHandovers) -- antes de este módulo cada uno redefinía el mismo
 * `ServiceError`/`Result<T>`/`normalizeUnexpectedError` palabra por
 * palabra. El mensaje genérico de cada servicio sigue siendo propio (se
 * pasa como parámetro): no hay que unificar copy, solo el tipo y el
 * logging.
 */
export interface ServiceError {
  code: string;
  message: string;
}

export type ServiceResult<T> = { data: T; error: null } | { data: null; error: ServiceError };

/**
 * Nunca propaga el error crudo -- puede envolver una respuesta de red u
 * otro dato sensible. Solo loguea un marcador no sensible (`tag`/`context`)
 * fuera de producción y devuelve el mensaje genérico que le pasó el
 * servicio llamante.
 */
export function normalizeUnexpectedError(
  tag: string,
  context: string,
  _err: unknown,
  message: string
): ServiceError {
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[${tag}] unexpected error in ${context}`);
  }

  return {
    code: 'unexpected_error',
    message,
  };
}
