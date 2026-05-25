import { type PadiContext, graphql } from '../padi-client.js';

const QUERY = `query logbook_logs_aggregate($affiliate_id: Int!) {
  logbook_logs_aggregate(where: {affiliate_id: {_eq: $affiliate_id}}) {
    aggregate { count }
  }
}`;

export async function countDives(ctx: PadiContext): Promise<number> {
  const data = await graphql<{
    logbook_logs_aggregate: { aggregate: { count: number } };
  }>(ctx, {
    operationName: 'logbook_logs_aggregate',
    query: QUERY,
    variables: { affiliate_id: Number(ctx.affiliateId) },
  });
  return data.logbook_logs_aggregate.aggregate.count;
}
