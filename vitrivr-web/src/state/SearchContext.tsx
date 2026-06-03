"use client";
import React, {createContext, useContext, useEffect, useState} from "react";
import type {BlockState} from "../components/SearchCard";
import {makeBlockState} from "./makeBlockState";

type MediaKind = "image" | "video" | "custom";
export type MediaItem = {
    start: number;
    end: number;
    name: string;
    id: string; kind: MediaKind; thumbUrl?: string; rawType?: string; url: string
};

type MediaFilter = { image: boolean; video: boolean; custom: boolean; uniqueVideos: boolean };

type SearchState = {
    schema: string;
    setSchema: (s: string) => void;

    blocks: BlockState[];
    setBlocks: React.Dispatch<React.SetStateAction<BlockState[]>>;

    items: MediaItem[];
    setItems: React.Dispatch<React.SetStateAction<MediaItem[]>>;

    mediaFilter: MediaFilter;
    setMediaFilter: React.Dispatch<React.SetStateAction<MediaFilter>>;

    raw: string;
    setRaw: React.Dispatch<React.SetStateAction<string>>;

    scrollY: number;
    setScrollY: (y: number) => void;

    vectorsById: Record<string, number[]>;
    setVectorsById: React.Dispatch<React.SetStateAction<Record<string, number[]>>>;

    faceGallery: Record<string, number[]>;
    setFaceGallery: React.Dispatch<React.SetStateAction<Record<string, number[]>>>;
};

const SearchCtx = createContext<SearchState | null>(null);

export function SearchProvider({children, initial}: {
    children: React.ReactNode;
    initial: Pick<SearchState, "blocks">
}) {

    const ensureAtLeastOne = (bs: BlockState[]) =>
        bs.length === 0 ? [makeBlockState()] : bs;

    const [blocks, _setBlocks] = useState<BlockState[]>(
        ensureAtLeastOne(initial.blocks ?? [])
    );

    const setBlocks: React.Dispatch<React.SetStateAction<BlockState[]>> = (next) => {
        _setBlocks((prev) => {
            const resolved = typeof next === "function" ? (next as any)(prev) : next;
            return ensureAtLeastOne(resolved);
        });
    };

    const [items, setItems] = useState<SearchState["items"]>([]);
    const [mediaFilter, setMediaFilter] = useState<MediaFilter>({
        image: true,
        video: true,
        custom: true,
        uniqueVideos: true,
    });
    const [raw, setRaw] = useState("");
    const [scrollY, _setScrollY] = useState(0);
    const [schema, setSchema] = useState<string>(() => {
        try {
            return localStorage.getItem("vitrivr_schema")
                ?? import.meta.env.VITE_VITRIVR_SCHEMA
                ?? "";
        } catch {
            return import.meta.env.VITE_VITRIVR_SCHEMA ?? "";
        }
    });
    const setScrollY = (y: number) => _setScrollY(y);
    const [vectorsById, setVectorsById] = useState<Record<string, number[]>>({});
    const [faceGallery, setFaceGallery] = useState<Record<string, number[]>>(() => {
        try {
            const stored = localStorage.getItem("vitrivr_faceGallery");
            return stored ? JSON.parse(stored) as Record<string, number[]> : {};
        } catch {
            return {};
        }
    });

    // Persist gallery to localStorage whenever it changes
    useEffect(() => {
        try {
            localStorage.setItem("vitrivr_faceGallery", JSON.stringify(faceGallery));
        } catch {
            // ignore quota / private-browsing errors
        }
    }, [faceGallery]);

    // Load pre-built gallery JSON if a URL is configured; remote entries fill gaps only
    useEffect(() => {
        const galleryUrl = import.meta.env.VITE_GALLERY_URL as string | undefined;
        if (!galleryUrl) return;

        fetch(galleryUrl)
            .then(r => r.json())
            .then((data: unknown) => {
                const people = (data as any)?.people ?? {};
                const remote: Record<string, number[]> = {};
                for (const [name, info] of Object.entries(people)) {
                    const emb = (info as any)?.embedding;
                    if (Array.isArray(emb) && emb.length > 0) remote[name] = emb as number[];
                }
                // Merge: remote is the base; locally registered persons take precedence
                setFaceGallery(prev => ({...remote, ...prev}));
                console.log(`[FaceGallery] Merged ${Object.keys(remote).length} person(s) from ${galleryUrl}`);
            })
            .catch(err => console.warn("[FaceGallery] Could not load gallery:", err));
    }, []);

    return (
        <SearchCtx.Provider
            value={{
                schema,
                setSchema,
                blocks,
                setBlocks,
                items,
                setItems,
                mediaFilter,
                setMediaFilter,
                raw,
                setRaw,
                scrollY,
                setScrollY,
                vectorsById,
                setVectorsById,
                faceGallery,
                setFaceGallery,
            }}
        >
            {children}
        </SearchCtx.Provider>
    );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSearch() {
    const ctx = useContext(SearchCtx);
    if (!ctx) throw new Error("useSearch must be used within SearchProvider");
    return ctx;
}
