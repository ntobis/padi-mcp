import { type PadiContext, graphql } from '../padi-client.js';
import { naiveDatetimeToIsoDate } from '../transforms/dates.js';
import { toNumber } from '../transforms/numbers.js';
import { type DiveSummary, RawDiveListItem } from '../types.js';

const QUERY = `query logbook_logs($affiliate_id: Int!, $limit: Int, $offset: Int) {
  logbook_logs(
    where: {affiliate_id: {_eq: $affiliate_id}}
    order_by: {dive_date: desc, id: desc}
    limit: $limit
    offset: $offset
  ) {
    id
    log_type
    log_course
    log_number
    dive_title
    dive_date
    dive_location
    status
  }
}`;

export async function listDives(
  ctx: PadiContext,
  args: { limit?: number; offset?: number } = {},
): Promise<DiveSummary[]> {
  const data = await graphql<{ logbook_logs: unknown[] }>(ctx, {
    operationName: 'logbook_logs',
    query: QUERY,
    variables: {
      affiliate_id: Number(ctx.affiliateId),
      limit: args.limit ?? 20,
      offset: args.offset ?? 0,
    },
  });
  return data.logbook_logs.map((row) => {
    const parsed = RawDiveListItem.parse(row);
    return {
      id: parsed.id,
      log_type: parsed.log_type ?? null,
      log_course: parsed.log_course ?? null,
      log_number: toNumber(parsed.log_number),
      dive_title: parsed.dive_title ?? null,
      dive_date: naiveDatetimeToIsoDate(parsed.dive_date),
      dive_location: parsed.dive_location ?? null,
      status: parsed.status ?? null,
    };
  });
}
