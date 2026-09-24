export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const rel = specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:');
    if (rel && !/\.(m|c)?(j|t)sx?$/.test(specifier)) {
      for (const ext of ['.ts', '.tsx', '/index.ts']) {
        try {
          return await next(specifier + ext, context);
        } catch {
          /* prova la prossima */
        }
      }
    }
    throw err;
  }
}
