import type {ClusterTimelineSegment, ClusterTimelineVideo} from "./clusters";

/**
 * Temporal-sequence search over cluster timelines: "person X appears, then person Y
 * appears within a time window", evaluated per video. Pure functions over the data
 * `getClusterTimeline` already returns — no backend involved.
 */

/** A person's continuous on-screen appearance: consecutive timeline segments coalesced. */
export type AppearanceInterval = {
    startNs: number;
    endNs: number;
    /** Segments composing this appearance, in time order (first one is used for thumbnails). */
    segmentIds: string[];
};

export type SequenceMatch = {
    sourceId: string;
    filePath?: string | null;
    x: AppearanceInterval;
    y: AppearanceInterval;
    /** y.start minus the chosen anchor on x (>= 0). */
    lagNs: number;
};

export type SequenceOptions = {
    /** Max allowed lag between the anchor on X and the start of Y's appearance. */
    windowNs: number;
    /** Gaps up to this size between a person's segments are bridged into one appearance.
        Without coalescing, every segment boundary would spawn artificial "reappearances". */
    maxGapNs: number;
    /** Where the window starts counting: when X first appears, or when X disappears. */
    anchor: "start" | "end";
};

/** Merge a cluster's timeline segments (per video) into continuous appearance intervals. */
export function coalesceSegments(
    segments: ClusterTimelineSegment[],
    maxGapNs: number,
): AppearanceInterval[] {
    const sorted = [...segments].sort((a, b) => a.startNs - b.startNs);
    const out: AppearanceInterval[] = [];
    for (const s of sorted) {
        const last = out[out.length - 1];
        if (last && s.startNs - last.endNs <= maxGapNs) {
            last.endNs = Math.max(last.endNs, s.endNs);
            last.segmentIds.push(s.segmentId);
        } else {
            out.push({startNs: s.startNs, endNs: s.endNs, segmentIds: [s.segmentId]});
        }
    }
    return out;
}

/**
 * Find every (X appearance, Y appearance) pair in the same video where Y starts within
 * `windowNs` after the anchor point of X. Y appearances beginning before the anchor are
 * not matches (this is a sequence query, not co-occurrence — lag is always >= 0).
 */
export function findSequenceMatches(
    xVideos: ClusterTimelineVideo[],
    yVideos: ClusterTimelineVideo[],
    opts: SequenceOptions,
): SequenceMatch[] {
    const ysBySource = new Map(yVideos.map(v => [v.sourceId, v]));
    const matches: SequenceMatch[] = [];

    for (const xv of xVideos) {
        const yv = ysBySource.get(xv.sourceId);
        if (!yv) continue;

        const xIntervals = coalesceSegments(xv.segments, opts.maxGapNs);
        const yIntervals = coalesceSegments(yv.segments, opts.maxGapNs);

        for (const xi of xIntervals) {
            const anchorNs = opts.anchor === "start" ? xi.startNs : xi.endNs;
            for (const yi of yIntervals) {
                const lagNs = yi.startNs - anchorNs;
                if (lagNs < 0 || lagNs > opts.windowNs) continue;
                matches.push({
                    sourceId: xv.sourceId,
                    filePath: xv.filePath ?? yv.filePath,
                    x: xi,
                    y: yi,
                    lagNs,
                });
            }
        }
    }

    matches.sort((a, b) =>
        a.sourceId === b.sourceId ? a.x.startNs - b.x.startNs : a.sourceId.localeCompare(b.sourceId));
    return matches;
}
