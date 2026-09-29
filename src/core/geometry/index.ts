/**
 * Geometry ingest façade — bytes in, corpus-ready material out.
 *
 * `describeAsset` is the single entry point used by both the acquisition loop
 * and the local drop target. It never fabricates: an unrecognised or empty
 * file returns `ok: false` with the reason, and the caller records a failure.
 */

import {
  classifyAsset,
  sniffAsset,
  parseGeometry,
  type AssetKind,
  type GeometryDoc,
} from './parse';
import { describeGeometry, summariseGeometry, type GeometryDescriptor } from './descriptors';

export * from './parse';
export * from './descriptors';

export interface AssetDescription {
  ok: boolean;
  reason?: string;
  kind: AssetKind;
  doc?: GeometryDoc;
  descriptor?: GeometryDescriptor;
  /** measurement summary — this is what enters the knowledge base */
  text?: string;
}

export const GEOMETRY_EXTENSIONS = [
  '.dxf',
  '.svg',
  '.obj',
  '.stl',
  '.ifc',
  '.step',
  '.stp',
] as const;

export function isGeometryUrl(url: string): boolean {
  const u = url.toLowerCase().split(/[?#]/)[0];
  return GEOMETRY_EXTENSIONS.some((e) => u.endsWith(e));
}

export function describeAsset(
  text: string,
  url: string,
  contentType = '',
  title = '',
): AssetDescription {
  const body = text ?? '';
  if (body.trim().length < 32)
    return { ok: false, kind: 'unknown', reason: `empty asset (${body.length} chars)` };

  let kind = classifyAsset(url, contentType);
  if (kind === 'unknown') kind = sniffAsset(body);
  if (kind === 'unknown') return { ok: false, kind, reason: 'unrecognised geometry format' };

  const doc = parseGeometry(body, kind);
  const hasGeometry = doc.segments.length > 0 || doc.points.length > 0;
  const hasSemantics = doc.entities.size > 0;
  if (!hasGeometry && !hasSemantics) {
    return { ok: false, kind, reason: `${kind} parsed but carried no primitives` };
  }

  const descriptor = describeGeometry(doc);
  const label = title || url.split('/').pop() || url;
  return { ok: true, kind, doc, descriptor, text: summariseGeometry(descriptor, label) };
}
