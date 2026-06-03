import type {BlockState} from "../components/SearchCard.tsx";

export const SCHEMA = import.meta.env.VITE_VITRIVR_SCHEMA
export const API_BASE = import.meta.env.VITE_VITRIVR_BASE_URL;
export const THUMBNAIL_BASE = import.meta.env.VITE_THUMBNAIL_ORIGIN;
export const MEDIA_BASE = import.meta.env.VITE_MEDIA_ORIGIN;
export const MEDIA_PATH_PREFIX: string = import.meta.env.VITE_MEDIA_PATH_PREFIX ?? "";

type TextInput = { type: "TEXT"; data: string };
type FloatVectorInput = { type: "FLOATVECTOR"; data: number[] };
type Input = TextInput | FloatVectorInput;
type Inputs = Record<string, Input>;
type RawSchema = string | { name?: string; [key: string]: unknown };


// /**
//  * Builds the thumbnail URL for a given segment or media id.
//  *
//  * The current implementation is tailored to the VBS 2026 thumbnail layout,
//  * where thumbnails are stored in shard folders derived from the first two
//  * characters of the raw id.
//  * @param schema - Active vitrivr schema name
//  * @param id - Segment or media identifier used to locate the thumbnail
//  * @returns The absolute thumbnail URL, or an empty string if it cannot be built
//  */
// export function thumbnailUrl(schema: string, id: string): string {
//     if (!THUMBNAIL_BASE) return "";

//     const clean = (id ?? "").trim();
//     if (!clean) return "";

//     // shared folder = first 2 characters of the raw id
//     const shard = clean.slice(0, 2);
//     const encId = encodeURIComponent(clean);

//     return `${THUMBNAIL_BASE}/vbs/${schema.toUpperCase()}/thumbnails/shards/${encodeURIComponent(shard)}/${encId}.jpg`;
// }
export function thumbnailUrl(schema: string, id: string): string {
    if (!THUMBNAIL_BASE) return "";
    const clean = (id ?? "").trim();
    if (!clean) return "";
    return `${THUMBNAIL_BASE}/thumbnails/${encodeURIComponent(clean)}.jpg`;
}


/**
 * Extracts the filename from a filesystem-style path.
 *
 * @param p - Full path string
 * @returns The basename of the path, or an empty string if unavailable
 */
function basenameFromPath(p: string): string {
    const unixy = p.replace(/\\/g, "/");
    const parts = unixy.split("/");
    return parts[parts.length - 1] ?? "";
}

/**
 * Builds a public video URL from a source file path. 
 * Changed
 *
 * @param schema - Active vitrivr schema name
 * @param filePath - Original file path descriptor from the backend
 * @returns A playable video URL, or an empty string if it cannot be built
 */
export function servedVideoUrl(schema: string, filePath: string): string {
    if (!MEDIA_BASE) return "";
    const normalized = filePath.replace(/\\/g, "/");
    const prefix = MEDIA_PATH_PREFIX.replace(/\\/g, "/").replace(/\/?$/, "/");
    const relative = prefix && normalized.startsWith(prefix)
        ? normalized.slice(prefix.length)
        : basenameFromPath(normalized);
    if (!relative) return "";
    const encodedPath = relative.split("/").map(encodeURIComponent).join("/");
    const subpath = (import.meta.env.VITE_MEDIA_SUBPATH as string | undefined) ?? `vbs/${schema.toUpperCase()}/videos/`;
    return new URL(`${subpath}${encodedPath}`, MEDIA_BASE).toString();
}


/**
 * Minimal frontend representation of a retrievable object returned by vitrivr.
 *
 * This type is used by helper functions that inspect descriptors and
 * relationship metadata, especially for segment/video results.
 */
export type VitrivrRetrievable = {
    id?: string;
    type?: string;
    descriptors?: Record<string, unknown>;
    relationship?: {
        partOf?: {
            id?: string;
            type?: string;
            descriptors?: Record<string, unknown>;
        };
    };
};


/**
 * Extracts a usable file path from a retrievable.
 *
 * The method first checks the retrievable's own descriptors for `file.path`.
 * If not found, it falls back to the parent object's descriptors via
 * `relationship.partOf`.
 * @param r - A vitrivr retrievable object
 * @returns The resolved file path, or `undefined`
 */
export function pickFilePath(r: VitrivrRetrievable): string | undefined {
    const local = r.descriptors?.["file.path"];
    if (typeof local === "string" && local.trim()) return local;

    const parent = r.relationship?.partOf?.descriptors?.["file.path"];
    if (typeof parent === "string" && parent.trim()) return parent;

    return undefined;
}

export type BuiltMediaUrls = {
    url: string;
    thumbUrl: string;
    filePath?: string;
    filename?: string;
};

/**
 * Builds the media URLs needed to render a segment-like retrievable.
 * This helper is mainly intended for video segment results.
 * @param schema - Active vitrivr schema name
 * @param r - Segment-like retrievable object
 * @returns An object containing video and thumbnail URLs plus path metadata
 */
export function buildSegmentMediaUrls(schema: string, r: VitrivrRetrievable): BuiltMediaUrls {
    const id = (r.id ?? "").trim();
    const filePath = pickFilePath(r);
    const url = filePath ? servedVideoUrl(schema, filePath) : "";
    const thumbUrl = id ? thumbnailUrl(schema, id) : "";
    const filename = filePath ? basenameFromPath(filePath) : undefined;

    return {url, thumbUrl, filePath: filePath ?? undefined, filename};
}


/**
 * Fetches the list of available schemas from the vitrivr backend.
 * @returns A promise resolving to a list of schema names
 * @throws Error when the HTTP request fails
 */
export async function fetchSchemas(): Promise<string[]> {
    const url = `${API_BASE}/api/schema/list`;

    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`Failed to fetch schemas (HTTP ${res.status})`);
    }

    const data = await res.json() as unknown;
    let rawList: unknown;

    if (Array.isArray(data)) {
        rawList = data;
    } else if (data && typeof data === "object") {
        const obj = data as Record<string, unknown>;
        if (Array.isArray(obj.schemas)) {
            rawList = obj.schemas;
        } else if (Array.isArray(obj.result)) {
            rawList = obj.result;
        }
    }

    if (!Array.isArray(rawList)) {
        return [];
    }

    const names = (rawList as RawSchema[])
        .map((item) =>
            typeof item === "string"
                ? item
                : item?.name ?? undefined
        )
        .filter((name): name is string => typeof name === "string" && name.length > 0);

    return names;
}

/**
 * Build a temporal query that consists of multiple QueryBlocks.
 * @param blocks ordered list of QueryBlocks from the UI
 */
export function buildTemporalQuery(blocks: BlockState[]) {
    const LIMIT = "10";
    const summary: string[] = [];

    const hasImageBlock = blocks.some((b) => b.queryType === "image");
    if (hasImageBlock) {
        throw new Error("Temporal query currently supports only text/emotion blocks (no image blocks yet).");
    }
    const modalityToField = (m: BlockState["modality"]) => {
        switch (m) {
            case "clip":
                return "clip";
            case "asr":
                return "asr";
            case "ocr":
                return "ocr";
            default:
                return m;
        }
    };

    const emotionTypeToField = (emotionType?: string) => {
        if (emotionType === "face") return "emotionsface";
        if (emotionType === "ocr") return "emotionsocr";
        return "emotionssound";
    };

    const inputs: Inputs = {};
    const operations: Record<string, unknown> = {};
    const temporalInputs: Record<string, string> = {};

    let opIdx = 0;

    for (const b of blocks) {
        const inName = `in${opIdx}`;

        if (b.modality === "emotions") {
            const chosen = (b.emotion ?? "").trim();
            if (!chosen) {
                throw new Error("Temporal query: an emotions block is missing a selected emotion.");
            }

            const txt = (b.textQuery ?? "").trim();
            if (!txt) {
                throw new Error("Temporal query: an emotions block is missing text (needed for fusion).");
            }

            const txtKey = `txt-${opIdx}`;
            const vecKey = `e${opIdx}`;

            inputs[txtKey] = {type: "TEXT", data: txt};
            inputs[vecKey] = {type: "FLOATVECTOR", data: emotionsToVector(chosen)};

            const clipOp = `clip-${opIdx}`;
            const emoOp = `emotions-${opIdx}`;
            const rel1 = `relations-${opIdx}`;
            const rel2 = `relations2-${opIdx}`;
            const agg1 = `agg-${opIdx}`;
            const agg2 = `agg2-${opIdx}`;
            const fusion = `fusion-${opIdx}`;

            summary.push(`emotions(${chosen})+clip("${txt}")`);

            const emotionField = emotionTypeToField(b.emotionTarget);

            operations[clipOp] = {
                field: "clip",
                inputs: {txt: txtKey},
                parameters: {limit: LIMIT},
            };

            operations[emoOp] = {
                field: emotionField,
                inputs: {vec: vecKey},
                parameters: {limit: LIMIT},
            };

            operations[rel1] = {
                factory: "RelationExpander",
                inputs: {in: clipOp},
                parameters: {outgoing: "partOf"},
            };

            operations[rel2] = {
                factory: "RelationExpander",
                inputs: {in: emoOp},
                parameters: {outgoing: "partOf"},
            };

            operations[agg1] = {
                factory: "ScoreAggregator",
                inputs: {in: rel1},
            };

            operations[agg2] = {
                factory: "ScoreAggregator",
                inputs: {in: rel2},
            };

            operations[fusion] = {
                factory: "WeightedScoreFusion",
                inputs: {in: agg1, "in-2": agg2},
                parameters: {
                    weights: "0.7 , 100",
                    p: "2",
                    normalize: "true",
                },
            };

            temporalInputs[inName] = fusion;

            opIdx++;
            continue;
        }

        const txt = (b.textQuery ?? "").trim();
        if (!txt) {
            throw new Error(`Temporal query: a ${b.modality.toUpperCase()} block is missing text.`);
        }

        const txtKey = `t${opIdx}`;
        const opName = `op-${opIdx}`;
        inputs[txtKey] = {type: "TEXT", data: txt};
        summary.push(`${b.modality}: ${txt}`);

        operations[opName] = {
            field: modalityToField(b.modality),
            inputs: {txt: txtKey},
            parameters: {limit: LIMIT},
        };

        temporalInputs[inName] = opName;
        opIdx++;
    }

    if (opIdx === 0) {
        throw new Error("Temporal query needs at least one supported block.");
    }

    operations["temporal-aggregator"] = {
        factory: "TemporalSequenceAggregator",
        inputs: temporalInputs,
    };

    operations["relations"] = {
        factory: "RelationExpander",
        inputs: {in: "temporal-aggregator"},
        parameters: {outgoing: "partOf"},
    };

    operations["aggregator"] = {
        factory: "ScoreAggregator",
        inputs: {in: "relations"},
    };

    operations["timelookup"] = {
        factory: "FieldLookup",
        inputs: {in: "aggregator"},
        parameters: {field: "time", keys: "start, end"},
    };

    operations["desclookup"] = {
        factory: "FieldLookup",
        inputs: {in: "timelookup"},
        parameters: {"field": "clip", "keys": "descriptord"},
    };

    operations["filelookup"] = {
        factory: "ObjectFieldLookup",
        inputs: {in: "desclookup"},
        parameters: {field: "file", predicates: "partOf", keys: "path"},
    };

    console.log("[TemporalQuery] sequence:", summary.join(" → "));

    return {
        inputs,
        operations,
        output: "filelookup",
    } as const;
}

/**
 * Converts file object into base64 data URL String.
 * @param file File to convert
 */
export function fileToBase64(file: File | null): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            const result = reader.result;
            if (typeof result === "string") {
                resolve(result);
            } else {
                reject(new Error("Failed to convert file to base64"));
            }
        };

        reader.onerror = () => {
            reject(reader.error ?? new Error("FileReader error"));
        };

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        reader.readAsDataURL(file);
    });
}


/**
 * Builds the query for vitrivr-engine for textual queries
 * @param prompt the textual query
 * @param field such as clip, ocr, asr, or emotions
 * @param emotions emotion label such as happy, sad, etc.
 * @param emotionType where the emotions occurs such as face, asr or ocr.
 */
export function buildTextQuery(
    field: string,
    prompt: string,
    emotions: string = "",
    emotionType: string = ""
) {
    const LIMIT = "1000";

    let emotionField = "emotionssound";
    if (emotionType === "face") emotionField = "emotionsface";
    else if (emotionType === "ocr") emotionField = "emotionsocr";

    if (field === "emotions") {
        const emotionsVector = emotionsToVector(emotions);

        const inputs: Inputs = {
            "txt-1": {type: "TEXT", data: prompt},
            emotion: {type: "FLOATVECTOR", data: emotionsVector},
        };

        const operations: Record<string, unknown> = {
            clip: {
                field: "clip",
                inputs: {txt: "txt-1"},
                parameters: {limit: LIMIT},
            },

            emotions: {
                field: emotionField,
                inputs: {vec: "emotion"},
                parameters: {limit: LIMIT},
            },

            relations: {
                factory: "RelationExpander",
                inputs: {in: "clip"},
                parameters: {outgoing: "partOf"},
            },
            "relations-2": {
                factory: "RelationExpander",
                inputs: {in: "emotions"},
                parameters: {outgoing: "partOf"},
            },

            aggregator: {
                factory: "ScoreAggregator",
                inputs: {in: "relations"},
            },
            "aggregator-2": {
                factory: "ScoreAggregator",
                inputs: {in: "relations-2"},
            },

            fusion: {
                factory: "WeightedScoreFusion",
                inputs: {in: "aggregator", "in-2": "aggregator-2"},
                parameters: {
                    weights: "0.7 , 100",
                    p: "2",
                    normalize: "true",
                },
            },

            timelookup: {
                factory: "FieldLookup",
                inputs: {in: "fusion"},
                parameters: {field: "time", keys: "start, end"},
            },
            filelookup: {
                factory: "ObjectFieldLookup",
                inputs: {in: "timelookup"},
                parameters: {field: "file", predicates: "partOf", keys: "path"},
            },
        };

        return {
            inputs,
            operations,
            output: "filelookup",
        } as const;
    }

    const inputs: Inputs = {
        txt: {type: "TEXT", data: prompt},
    };

    const operations: Record<string, unknown> = {
        clip: {
            field,
            inputs: {txt: "txt"},
            parameters: {limit: LIMIT},
        },
    };

    const output = addSegmentToFileLookups(operations, "clip");
    return {inputs, operations, output} as const;
}

/**
 * Builds a vector-based vitrivr query that is used for the nearest neighbor search.
 * @param vector embedding vector
 * @param limit maximum number of retrieval results
 */
export function buildVectorQuery(vector: number[], limit: number) {
    return {
        "inputs": {
            "txt": {
                "type": "FLOATVECTOR", "data": vector
            }
        },
        "operations": {
            "clip": {"field": "clip", "inputs": {"txt": "txt"}, "parameters": {"limit": limit.toString()}},

            "relations": {
                "factory": "RelationExpander",
                "inputs": {"in": "clip"},
                "parameters": {"outgoing": "partOf"}
            },
            "aggregator": {"factory": "ScoreAggregator", "inputs": {"in": "relations"}},
            "timelookup": {
                "factory": "FieldLookup",
                "inputs": {"in": "aggregator"},
                "parameters": {"field": "time", "keys": "start, end"}
            },
            "desclookup": {
                "factory": "FieldLookup",
                "inputs": {"in": "timelookup"},
                "parameters": {"field": "clip", "keys": "descriptord"}
            },
            "filelookup": {
                "factory": "ObjectFieldLookup",
                "inputs": {"in": "desclookup"},
                "parameters": {"field": "file", "predicates": "partOf", "keys": "path"}
            }
        },
        "output": "filelookup"
    } as const
}

/**
 * Converts emotion labels into a one-hot representation
 * @param emotion label
 * @returns the one-hot encoded vector
 */
export function emotionsToVector(emotion: string | undefined | null): number[] {
    const orderingEmotions = ["anger", "disgust", "fear", "happy", "neutral", "sad", "surprise"];

    if (!emotion) {
        return new Array(orderingEmotions.length).fill(0);
    }

    const normalized = emotion.toLowerCase().trim();

    return orderingEmotions.map(e => (e === normalized ? 1 : 0));
}


type Ops = Record<string, unknown>;


/**
 * Append the standard lookup chain.
 */
function addSegmentToFileLookups(operations: Ops, inputOp: string) {
    operations["relations"] = {
        factory: "RelationExpander",
        inputs: {in: inputOp},
        parameters: {outgoing: "partOf"},
    };

    operations["aggregator"] = {
        factory: "ScoreAggregator",
        inputs: {in: "relations"},
    };

    operations["timelookup"] = {
        factory: "FieldLookup",
        inputs: {in: "aggregator"},
        parameters: {field: "time", keys: "start, end"},
    };

    operations["desclookup"] = {
        factory: "FieldLookup",
        inputs: {in: "timelookup"},
        parameters: {field: "clip", keys: "descriptord"},
    };

    operations["filelookup"] = {
        factory: "ObjectFieldLookup",
        inputs: {in: "desclookup"},
        parameters: {field: "file", predicates: "partOf", keys: "path"},
    };

    return "filelookup" as const;
}
