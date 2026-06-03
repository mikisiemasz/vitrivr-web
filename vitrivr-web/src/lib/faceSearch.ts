import {retrieval} from "../vitirvr/api/client";
import {buildSegmentMediaUrls, thumbnailUrl, type VitrivrRetrievable} from "./vitrivr";

export const FACE_SERVER_URL =
    (import.meta.env.VITE_FACE_SERVER_URL as string | undefined) ?? "http://127.0.0.1:8888";

/**
 * Minimum cosine-similarity score (0–1) for a face result to be kept.
 * Results below this threshold are discarded before intersection / display.
 * The value mirrors the standalone pipeline's SIMILARITY_THRESHOLD.
 */
export const FACE_SCORE_THRESHOLD =
    parseFloat((import.meta.env.VITE_FACE_SCORE_THRESHOLD as string | undefined) ?? "0") || 0;

async function fileToBase64DataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("FileReader error"));
        reader.readAsDataURL(file);
    });
}

/**
 * The per-face object returned by the updated Python server.
 * Older server versions returned bare number[][] — both shapes are handled below.
 */
type FaceDetectionPayload = {
    embedding: number[];
    bbox: number[];   // [x1, y1, x2, y2]
    score: number;
};

type RawFaceResponse = FaceDetectionPayload[] | number[][];

/**
 * Normalise the server response into a uniform list of [FaceDetectionPayload].
 * Handles both the new rich format and the legacy flat-array format.
 */
function normaliseFaceResponse(raw: RawFaceResponse): FaceDetectionPayload[] {
    if (!Array.isArray(raw) || raw.length === 0) return [];
    const first = raw[0];
    if (Array.isArray(first)) {
        // Legacy: [[512 floats], ...]
        return (raw as number[][]).map(emb => ({embedding: emb, bbox: [], score: 1}));
    }
    // New rich format: [{embedding, bbox, score}, ...]
    return raw as FaceDetectionPayload[];
}

/**
 * Send a face image to the descriptor server and return a single normalized
 * 512-d embedding. Throws if 0 or >1 face is detected.
 */
export async function extractFaceEmbedding(file: File): Promise<number[]> {
    const dataUrl = await fileToBase64DataUrl(file);
    const form = new FormData();
    form.append("data", dataUrl);

    // Proxy via Vite dev proxy to avoid CORS during development; see vite.config.ts
    const resp = await fetch(`/face-api/extract/face_embedding`, {
        method: "POST",
        body: form,
    });

    if (!resp.ok) throw new Error(`Face server returned HTTP ${resp.status}`);

    const raw = await resp.json() as RawFaceResponse;
    const detections = normaliseFaceResponse(raw);

    if (detections.length === 0)
        throw new Error("No face detected in the image — try a clearer photo");
    if (detections.length > 1)
        throw new Error(`${detections.length} faces detected — use a photo with exactly one face`);

    return detections[0].embedding;
}

/**
 * Send multiple face images and average their embeddings into one gallery entry.
 * At least one image must contain exactly one detected face; images with 0 or
 * multiple faces are silently skipped.
 *
 * @returns Averaged, normalized 512-d embedding.
 * @throws  If no usable single-face image was found across all files.
 */
export async function extractAveragedFaceEmbedding(files: File[]): Promise<number[]> {
    const collected: number[][] = [];

    for (const file of files) {
        try {
            const emb = await extractFaceEmbedding(file);
            collected.push(emb);
        } catch {
            // skip images with 0 or >1 faces
        }
    }

    if (collected.length === 0)
        throw new Error("None of the selected images contained exactly one face.");

    const dim = collected[0].length;
    const sum = new Array<number>(dim).fill(0);
    for (const emb of collected) {
        for (let i = 0; i < dim; i++) sum[i] += emb[i];
    }
    const mean = sum.map(v => v / collected.length);

    // L2-normalise the mean
    const norm = Math.sqrt(mean.reduce((a, x) => a + x * x, 0)) || 1;
    return mean.map(x => x / norm);
}

export function buildFaceQuery(vector: number[], limit: number) {
    return {
        inputs: {
            "face-query": {type: "FLOATVECTOR", data: vector},
        },
        operations: {
            face: {
                field: "face",
                inputs: {vec: "face-query"},
                parameters: {limit: String(limit)},
            },
            relations: {
                factory: "RelationExpander",
                inputs: {in: "face"},
                parameters: {outgoing: "partOf"},
            },
            aggregator: {
                factory: "ScoreAggregator",
                inputs: {in: "relations"},
            },
            timelookup: {
                factory: "FieldLookup",
                inputs: {in: "aggregator"},
                parameters: {field: "time", keys: "start, end"},
            },
            filelookup: {
                factory: "ObjectFieldLookup",
                inputs: {in: "timelookup"},
                parameters: {field: "file", predicates: "partOf", keys: "path"},
            },
        },
        output: "filelookup",
    } as const;
}

export type FaceResultItem = {
    retrievableId: string;
    score: number;
    startNs: number;
    endNs: number;
    raw: VitrivrRetrievable;
};

export type FaceResultMap = Map<string, FaceResultItem>;

type RawApiItem = VitrivrRetrievable & {score?: number | string};

function pickScalarDescriptor(r: VitrivrRetrievable, key: string): number {
    const v = r.descriptors?.[key];
    if (typeof v === "number") return v;
    if (typeof v === "string") return Number(v) || 0;
    return 0;
}

function normalizeResponse(resp: unknown): FaceResultMap {
    const map: FaceResultMap = new Map();
    const list: unknown[] = Array.isArray(resp)
        ? resp
        : ((resp as Record<string, unknown>)?.retrievables as unknown[] ?? []);

    for (const item of list) {
        const r = item as RawApiItem;
        const faceId = r.id?.trim();
        if (!faceId) continue;

        /* Key by parent SEGMENT id so intersection with CLIP / other modalities
           (which key by segment id) lines up. Fall back to face id if no parent. */
        const segmentId = (r.relationship?.partOf?.id ?? faceId).trim();
        if (!segmentId) continue;

        const score = typeof r.score === "number" ? r.score
            : typeof r.score === "string" ? parseFloat(r.score) || 0
            : 0;

        if (score < FACE_SCORE_THRESHOLD) continue;

        /* If multiple faces in the same segment match, keep the highest-scoring one. */
        const existing = map.get(segmentId);
        if (existing && existing.score >= score) continue;

        map.set(segmentId, {
            retrievableId: segmentId,
            score,
            startNs: pickScalarDescriptor(r, "time.start"),
            endNs: pickScalarDescriptor(r, "time.end"),
            raw: r,
        });
    }
    return map;
}

export async function queryFaceVector(
    vector: number[],
    schema: string,
    limit: number,
): Promise<FaceResultMap> {
    const body = buildFaceQuery(vector, limit);
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    const resp = await retrieval.postExecuteQuery(schema, body);
    return normalizeResponse(resp);
}

/** Intersect N maps. Only ids present in all maps survive. Score = min. */
export function intersectMaps(maps: FaceResultMap[]): FaceResultMap {
    if (maps.length === 0) return new Map();
    if (maps.length === 1) return new Map(maps[0]);

    const [first, ...rest] = maps;
    const out: FaceResultMap = new Map();

    for (const [id, item] of first) {
        if (rest.every(m => m.has(id))) {
            const allScores = [item.score, ...rest.map(m => m.get(id)!.score)];
            out.set(id, {...item, score: Math.min(...allScores)});
        }
    }
    return out;
}

/** Remove every id present in any exclude map from base. */
export function subtractMaps(base: FaceResultMap, excludeMaps: FaceResultMap[]): FaceResultMap {
    if (excludeMaps.length === 0) return base;
    const excludeIds = new Set(excludeMaps.flatMap(m => [...m.keys()]));
    const out: FaceResultMap = new Map();
    for (const [id, item] of base) {
        if (!excludeIds.has(id)) out.set(id, item);
    }
    return out;
}


export type FaceMediaItem = {
    id: string;
    url: string;
    thumbUrl: string;
    name: string;
    start: number;
    end: number;
    score: number;
};

export function faceMapToMediaItems(schema: string, map: FaceResultMap): FaceMediaItem[] {
    const items: FaceMediaItem[] = [];

    for (const item of map.values()) {
        /* Face results return FACE_DETECTION retrievables. The viewable segment is partOf.
           Fall back to face id if partOf is missing, so we at least render something. */
        const parent = item.raw.relationship?.partOf;
        const segmentId = (parent?.id ?? item.retrievableId).trim();
        const {url, thumbUrl, filename} = buildSegmentMediaUrls(
            schema,
            parent ? {...parent, id: segmentId} as VitrivrRetrievable : item.raw,
        );

        items.push({
            id: segmentId,
            url,
            thumbUrl: thumbUrl || thumbnailUrl(schema, segmentId),
            name: filename ?? "",
            start: item.startNs / 1_000_000_000,
            end: item.endNs / 1_000_000_000,
            score: item.score,
        });
    }

    items.sort((a, b) => b.score - a.score);
    return items;
}
