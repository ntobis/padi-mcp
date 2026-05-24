import { graphql } from '../padi-client.js';

const QUERY = `query logbook_logs($name: String!) {
  logbook_dive_site(where: {name: {_ilike: $name}}) {
    id
    name
  }
}`;

export interface DiveSiteHit {
  id: number;
  name: string;
}

/**
 * Search dive sites by name. The query is wrapped in `%...%` so the caller
 * passes a plain substring (e.g. "South Point", not "%South Point%").
 */
export async function searchDiveSites(query: string): Promise<DiveSiteHit[]> {
  const wildcarded = query.includes('%') ? query : `%${query}%`;
  const data = await graphql<{ logbook_dive_site: DiveSiteHit[] }>({
    operationName: 'logbook_logs',
    query: QUERY,
    variables: { name: wildcarded },
  });
  return data.logbook_dive_site;
}
