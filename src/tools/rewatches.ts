import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RewatchService, type RewatchMediaType, type RewatchWriteMediaType, type RewatchStatus } from '../api/rewatches.js';
import { toMcpErrorResult } from '../api/errors.js';

const mediaType = z.enum(['movies', 'shows', 'anime']);
const listMediaType = z.enum(['all', 'movies', 'shows', 'anime']);
const ids = z.record(z.string(), z.union([z.string(), z.number()])).refine(
  value => Object.entries(value).some(([key, item]) => ['simkl', 'imdb', 'tmdb', 'tvdb', 'mal', 'anilist'].includes(key) && (
    typeof item === 'number' ? Number.isInteger(item) && item > 0
      : typeof item === 'string' && item.trim().length > 0
  )),
  'at least one valid media identifier is required',
);
const episode = z.object({ number: z.number().int().positive(), watched_at: z.string().datetime().optional() }).passthrough();
const season = z.object({ number: z.number().int().nonnegative(), episodes: z.array(episode).optional() }).passthrough();
const date = z.string().datetime();

function jsonResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function registerRewatchTools(server: McpServer, service: RewatchService): void {
  server.registerTool('simkl_start_rewatch', {
    description: 'Explicitly start or resume a Simkl rewatch session for a movie, TV show or anime already in the user history. Requires PRO/VIP. Simkl applies a two-day gap between repeat watches. The response includes the upstream rewatch_id and status; retain the ID for later updates.',
    inputSchema: {
      mediaType,
      ids,
      rewatch_id: z.number().int().positive().optional(),
      rewatch_status: z.enum(['active', 'closed', 'completed'] as const).optional(),
      watched_at: date.optional(),
      seasons: z.array(season).optional(),
    },
    annotations: { destructiveHint: true },
  }, async args => {
    try {
      return jsonResult(await service.start({
        mediaType: args.mediaType as RewatchWriteMediaType,
        ids: args.ids,
        ...(args.rewatch_id !== undefined ? { rewatch_id: args.rewatch_id } : {}),
        ...(args.rewatch_status ? { rewatch_status: args.rewatch_status as RewatchStatus } : {}),
        ...(args.watched_at ? { watched_at: args.watched_at } : {}),
        ...(args.seasons ? { seasons: args.seasons } : {}),
      }));
    } catch (error) { return toMcpErrorResult(error); }
  });

  server.registerTool('simkl_update_rewatch', {
    description: 'Add viewing events to a specific rewatch session. Always supply the rewatch_id returned by Simkl. TV/anime completion is determined by Simkl when all aired regular episodes are covered.',
    inputSchema: {
      mediaType,
      ids,
      rewatch_id: z.number().int().positive(),
      rewatch_status: z.enum(['active', 'closed', 'completed'] as const).optional(),
      watched_at: date.optional(),
      seasons: z.array(season).optional(),
    },
    annotations: { destructiveHint: true },
  }, async args => {
    try {
      return jsonResult(await service.update({
        mediaType: args.mediaType as RewatchWriteMediaType,
        ids: args.ids,
        rewatch_id: args.rewatch_id,
        ...(args.rewatch_status ? { rewatch_status: args.rewatch_status as RewatchStatus } : {}),
        ...(args.watched_at ? { watched_at: args.watched_at } : {}),
        ...(args.seasons ? { seasons: args.seasons } : {}),
      }));
    } catch (error) { return toMcpErrorResult(error); }
  });

  server.registerTool('simkl_get_rewatches', {
    description: 'Read canonical items and their separate rewatch rows for all media or one type. Rewatch rows include full episode progress and timestamps. Provide date_from for incremental reads; set initial_sync=true only for the first full read.',
    inputSchema: {
      mediaType: listMediaType,
      status: z.enum(['watching', 'plantowatch', 'hold', 'completed', 'dropped']),
      date_from: date.optional(),
      initial_sync: z.boolean().optional(),
    },
    annotations: { readOnlyHint: true, idempotentHint: true },
  }, async args => {
    try {
      return jsonResult(await service.list({
        mediaType: args.mediaType as RewatchMediaType,
        status: args.status,
        ...(args.date_from ? { date_from: args.date_from } : {}),
        ...(args.initial_sync ? { initial_sync: true } : {}),
      }));
    } catch (error) { return toMcpErrorResult(error); }
  });

  server.registerTool('simkl_stop_watching', {
    description: 'Stop watching and return Simkl’s full scrobble response. Set allow_rewatch=true only when the user explicitly chose to record this playback as a rewatch; it requires PRO/VIP and progress of at least 80%.',
    inputSchema: {
      body: z.record(z.string(), z.unknown()),
      allow_rewatch: z.boolean().optional().describe('Explicitly record this stop as a rewatch. Defaults to false.'),
    },
    annotations: { destructiveHint: true },
  }, async args => {
    try {
      return jsonResult(await service.stop({ body: args.body, allow_rewatch: args.allow_rewatch }));
    } catch (error) { return toMcpErrorResult(error); }
  });
}
