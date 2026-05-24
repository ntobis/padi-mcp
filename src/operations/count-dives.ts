import { graphql } from '../padi-client.js';
import { getSession } from '../session.js';

const QUERY = `query logbook_logs_aggregate($affiliate_id: Int!) {
  logbook_logs_aggregate(where: {affiliate_id: {_eq: $affiliate_id}}) {
    aggregate { count }
  }
}`;

export async function countDives(): Promise<number> {
  const { affiliate_id } = getSession();
  const data = await graphql<{
    logbook_logs_aggregate: { aggregate: { count: number } };
  }>({
    operationName: 'logbook_logs_aggregate',
    query: QUERY,
    variables: { affiliate_id: Number(affiliate_id) },
  });
  return data.logbook_logs_aggregate.aggregate.count;
}
