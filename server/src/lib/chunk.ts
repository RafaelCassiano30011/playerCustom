/**
 * D1 (SQLite) tem um limite de ~100 variáveis bindadas por statement.
 * Qualquer query que monta `inArray(...)` ou um INSERT multi-linha a partir
 * de uma lista de tamanho arbitrário (vinda do cliente) precisa ser quebrada
 * em pedaços pra não estourar esse limite quando a lista cresce.
 */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
