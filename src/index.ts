/** The Host entry intentionally registers no services, tools, or model context.
 * The Client reuses DSH's authenticated Session Controller event bridge. */
export const name = 'dsh-pulse';
export function apply(): void {}
