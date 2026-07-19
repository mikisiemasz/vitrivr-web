/**
 * QueryBlock
 *
 * A query builder block used to configure one search step in the UI.
 *
 * Features:
 * - Selects a search modality (for example CLIP, OCR, ASR, or emotions)
 * - Supports text and image query input where allowed
 * - Supports emotion selection and emotion target selection
 * - Adapts available options based on the active schema
 * - Allows removing the block when `onRemove` is provided
 *
 * Props:
 * @param block - Current state of the query block
 * @param onChange - Called with partial updates to the block state
 * @param onRemove - Optional handler for removing the block
 * @param modalityOptions - Available modality options
 * @param queryTypeItems - Available query type options, usually text or image
 * @param emotionItems - Available emotion dropdown items
 * @param schema - Active vitrivr schema, used to restrict unsupported modalities
 *
 * Behavior:
 * - CLIP supports both text and image queries
 * - OCR and ASR force text input
 * - Emotion mode shows emotion selection and emotion target controls
 * - Some schemas disable unsupported modalities such as emotions or ASR
 * - Switching query type clears incompatible input values
 *
 * Example:
 * <QueryBlock
 *   block={block}
 *   onChange={handleBlockChange}
 *   onRemove={handleRemove}
 *   modalityOptions={modalityOptions}
 *   queryTypeItems={queryTypeItems}
 *   emotionItems={emotionItems}
 *   schema="vbs"
 * />
 */


import {useEffect} from "react";
import RadioGroup, {type RadioOption} from "./RadioGroup.tsx";
import Dropdown, {type DropdownItem} from "./Dropdown.tsx";
import Input from "./Input.tsx";
//import FileUploader from "./FileUploader.tsx"; // was removed because of the VBS
import type {BlockState} from "../SearchCard.tsx";
import type {GalleryEntry} from "../../state/SearchContext.tsx";
import {
    DndContext,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type DragEndEvent,
} from "@dnd-kit/core";
import {
    SortableContext,
    arrayMove,
    horizontalListSortingStrategy,
    useSortable,
} from "@dnd-kit/sortable";
import {CSS} from "@dnd-kit/utilities";

type QueryType = Extract<BlockState['queryType'], string>;
type Modality = Extract<BlockState["modality"], string>;
type EmotionTarget = "face" | "sound" | "ocr";

export type QueryBlockProps = {
    block: BlockState;
    onChange: (patch: Partial<BlockState>) => void;
    onRemove?: () => void;
    modalityOptions: RadioOption<Modality>[];
    queryTypeItems: RadioOption<QueryType>[];
    emotionItems: DropdownItem[];
    schema: string;
    faceGallery?: Record<string, GalleryEntry>;
};

/** One draggable include-chip for the spatial-ordering view. */
function SortableIncludeChip({name, onRemove}: {name: string; onRemove: () => void}) {
    const {attributes, listeners, setNodeRef, transform, transition, isDragging} = useSortable({id: name});
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : 1,
        cursor: "grab",
        userSelect: "none",
    };
    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}
             className="fs-chip fs-chip--include">
            <span className="fs-chip__label">⋮⋮ {name}</span>
            <button
                className="fs-chip__btn"
                title="Remove from order"
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onRemove(); }}
            >×</button>
        </div>
    );
}

const emotionTargetItems =
    [
        {label: "Face", value: "face"},
        {label: "Sound", value: "sound"},
        {label: "OCR", value: "ocr"},
    ] as const satisfies RadioOption<EmotionTarget>[];

export default function QueryBlock({
                                       block,
                                       onChange,
                                       onRemove,
                                       modalityOptions,
                                       queryTypeItems,
                                       emotionItems,
                                       schema,
                                       faceGallery,
                                   }: QueryBlockProps) {
    const isEmotion = block.modality === "emotions";
    const isTextQuery = block.queryType === "text";
    const isCLIP = block.modality === "clip";
    const isFace = block.modality === "face";
    const upperSchema = (schema ?? "").toUpperCase();
    const restrictAudioAndEmotion = upperSchema === "LHE" || upperSchema === "MVK";
    const isOcrOrAsr = block.modality === "ocr" || block.modality === "asr";


    const allowedModalityOptions = restrictAudioAndEmotion
        ? modalityOptions.filter((o) => o.value !== "emotions" && o.value !== "asr")
        : modalityOptions;


    useEffect(() => {
        if (isTextQuery) onChange({file: null});
        else onChange({textQuery: ""});
    }, [isTextQuery]);

    useEffect(() => {
        if (isEmotion && !block.emotionTarget) {
            onChange({emotionTarget: "face"});
        }
        if (!isEmotion && block.emotionTarget) {
            onChange({emotionTarget: undefined});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isEmotion]);

    useEffect(() => {
        if (restrictAudioAndEmotion && (block.modality === "emotions" || block.modality === "asr")) {
            onChange({
                modality: "clip",
                emotion: undefined,
                emotionTarget: undefined,
                queryType: "text",
                textQuery: "",
                file: null,
            });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [restrictAudioAndEmotion]);

    useEffect(() => {
        if (isOcrOrAsr && block.queryType !== "text") {
            onChange({queryType: "text", file: null});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOcrOrAsr]);


    return (
        <div
            style={{
                position: "relative",
                background: "#ffffff",
                borderRadius: "20px",
                padding: "16px",
                boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
                width: "100%",     // fill grid column
                minWidth: 0,       // allow shrinking inside grid
                height: "auto",    // grow with content
                // remove maxWidth/maxHeight
            }}
        >
            {onRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    aria-label="Remove block"
                    style={{
                        position: "absolute",
                        top: 8,
                        right: 8,
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        border: "1px solid #ccc",
                        background: "#fff",
                        cursor: "pointer",
                        fontSize: 18,
                        lineHeight: "24px",
                        textAlign: "center",
                        padding: 0,
                    }}
                >
                    ×
                </button>
            )}

            <div style={{marginBottom: 16}}>
                <RadioGroup
                    label="Modalities"
                    options={allowedModalityOptions}
                    value={block.modality}
                    onChange={(v) => {
                        const nextIsOcrOrAsr = v === "ocr" || v === "asr";

                        onChange({
                            modality: v,
                            emotion: undefined,
                            // if switching to OCR/ASR -> force text query
                            ...(nextIsOcrOrAsr ? {queryType: "text", file: null} : {}),
                        });
                    }}
                    orientation="horizontal"
                />
            </div>

            <div style={{marginBottom: 16}}>
                {isCLIP && (
                    <RadioGroup
                        label="Query Type"
                        options={queryTypeItems}
                        value={block.queryType}
                        onChange={(v) => {
                            // CLIP can do both text+image
                            if (v === "image") onChange({queryType: "image", textQuery: ""});
                            else onChange({queryType: "text", file: null});
                        }}
                        orientation="horizontal"
                    />
                )}

                {isEmotion && (
                    <>
                        <Dropdown
                            items={emotionItems}
                            value={block.emotion}
                            onChange={(v) => onChange({emotion: v})}
                            placeholder="Select an Emotion"
                            label="Emotion"
                        />

                        <div style={{marginTop: 12}}>
                            <RadioGroup
                                label="Emotion target"
                                options={emotionTargetItems as any}
                                value={(block.emotionTarget ?? "face") as any}
                                onChange={(v) => onChange({emotionTarget: v as EmotionTarget})}
                                orientation="horizontal"
                            />
                        </div>
                    </>
                )}

            </div>

            <div>
                {isFace ? (
                    <FaceBlockChips
                        block={block}
                        onChange={onChange}
                        faceGallery={faceGallery ?? {}}
                    />
                ) : (isTextQuery || isEmotion) ? (
                    <Input
                        type="text"
                        value={block.textQuery}
                        onChange={(val: string) => onChange({textQuery: val})}
                        placeholder="Type your query…"
                    />
                ) : (
                    <Input
                        type="image"
                        onImageChange={(file) => onChange({file})}
                        className=""
                    />
                )}
            </div>
        </div>
    );
}

/**
 * Face-modality chip selector.
 *
 * - Always shows every gallery person as a clickable chip with +/- include/exclude buttons.
 * - Match modes: "same segment" (plain co-occurrence), "left → right" (spatial order) and
 *   "sequence" (temporal order: each next person appears within N seconds of the previous).
 * - When an ordering mode is on AND there are 2+ included chips:
 *     • Included chips appear in a separate horizontal sortable row above the gallery,
 *       reflecting the order that will be sent to /clusters/match (spatialOrder or
 *       temporalOrder respectively).
 *     • Dragging them rewrites `block.faceInclude` in the new order.
 * - Ordering modes are only enabled when every currently-included chip carries a clusterId
 *   (i.e. came from the People tab "+ Gallery" button). Otherwise they show a hint.
 */
function FaceBlockChips({block, onChange, faceGallery}: {
    block: BlockState;
    onChange: (patch: Partial<BlockState>) => void;
    faceGallery: Record<string, GalleryEntry>;
}) {
    const sensors = useSensors(useSensor(PointerSensor, {activationConstraint: {distance: 5}}));

    const include = block.faceInclude ?? [];
    const exclude = block.faceExclude ?? [];
    const includeSet = new Set(include);
    const excludeSet = new Set(exclude);

    const allIncludesAreClusters = include.every(n => !!faceGallery[n]?.clusterId);
    const canOrder = allIncludesAreClusters && include.length >= 2;
    const spatialActive = !!block.faceSpatial && canOrder;
    const temporalActive = !!block.faceTemporal && canOrder;
    const orderActive = spatialActive || temporalActive;

    function setInclude(next: string[]) {
        onChange({faceInclude: next});
    }
    function setExclude(next: string[]) {
        onChange({faceExclude: next});
    }
    function toggleInclude(name: string) {
        const has = includeSet.has(name);
        setInclude(has ? include.filter(n => n !== name) : [...include, name]);
        if (!has && excludeSet.has(name)) setExclude(exclude.filter(n => n !== name));
    }
    function toggleExclude(name: string) {
        const has = excludeSet.has(name);
        setExclude(has ? exclude.filter(n => n !== name) : [...exclude, name]);
        if (!has && includeSet.has(name)) setInclude(include.filter(n => n !== name));
    }
    function onDragEnd(e: DragEndEvent) {
        const {active, over} = e;
        if (!over || active.id === over.id) return;
        const oldIdx = include.indexOf(String(active.id));
        const newIdx = include.indexOf(String(over.id));
        if (oldIdx < 0 || newIdx < 0) return;
        setInclude(arrayMove(include, oldIdx, newIdx));
    }

    const galleryNames = Object.keys(faceGallery).sort();

    return (
        <div>
            {/* Match-mode selector: plain co-occurrence, spatial left→right, or temporal sequence.
                The ordering modes need every included chip to carry a clusterId (People tab
                "+ Gallery"), same gating for both. */}
            <div
                style={{display: "flex", alignItems: "center", gap: 12, fontSize: 12, color: "#666", marginBottom: 8, flexWrap: "wrap"}}
                title={canOrder
                    ? "Same segment: all included people co-occur. Left→right: they appear in this spatial order. " +
                      "Sequence: each next person appears within the window after the previous one."
                    : "Add ≥2 included chips that were added via the People tab \"+ Gallery\" button to enable ordering modes."}
            >
                <span>Match:</span>
                <label style={{display: "flex", alignItems: "center", gap: 4}}>
                    <input
                        type="radio"
                        checked={!orderActive}
                        onChange={() => onChange({faceSpatial: false, faceTemporal: false})}
                    />
                    same segment
                </label>
                <label style={{display: "flex", alignItems: "center", gap: 4, opacity: canOrder ? 1 : 0.5}}>
                    <input
                        type="radio"
                        checked={spatialActive}
                        disabled={!canOrder}
                        onChange={() => onChange({faceSpatial: true, faceTemporal: false})}
                    />
                    left → right
                </label>
                <label style={{display: "flex", alignItems: "center", gap: 4, opacity: canOrder ? 1 : 0.5}}>
                    <input
                        type="radio"
                        checked={temporalActive}
                        disabled={!canOrder}
                        onChange={() => onChange({faceTemporal: true, faceSpatial: false})}
                    />
                    sequence
                </label>
                {temporalActive && (
                    <label style={{display: "flex", alignItems: "center", gap: 4}}>
                        within
                        <input
                            type="number" min={1}
                            value={block.faceTemporalWindowS ?? 20}
                            onChange={e => onChange({faceTemporalWindowS: Math.max(1, Number(e.target.value) || 20)})}
                            style={{width: 56}}
                        />
                        s
                    </label>
                )}
                {!canOrder && include.length > 0 && !allIncludesAreClusters && (
                    <span style={{color: "#b45309"}}>
                        — ordering disabled: some included faces aren't clusters
                    </span>
                )}
            </div>

            {/* Ordering active: show ordered, draggable include row */}
            {orderActive && (
                <div style={{
                    marginBottom: 10, padding: "6px 8px",
                    background: "#f6f6f6", borderRadius: 8,
                }}>
                    <p style={{fontSize: 11, color: "#888", marginBottom: 6}}>
                        {spatialActive ? "Drag to set the left → right order" : "Drag to set the sequence order (first → last)"}
                    </p>
                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                        <SortableContext items={include} strategy={horizontalListSortingStrategy}>
                            <div className="fs-chips" style={{flexWrap: "wrap"}}>
                                {include.map(name => (
                                    <SortableIncludeChip
                                        key={name}
                                        name={name}
                                        onRemove={() => toggleInclude(name)}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                </div>
            )}

            {/* Standard gallery chips */}
            <div className="fs-chips">
                {galleryNames.map(name => {
                    const inc = includeSet.has(name);
                    const exc = excludeSet.has(name);
                    /* When an ordering mode is on, included chips live in the sortable row
                       above — hide them from this list to avoid double-rendering. */
                    if (orderActive && inc) return null;
                    return (
                        <div key={name} className={`fs-chip${inc ? " fs-chip--include" : ""}${exc ? " fs-chip--exclude" : ""}`}>
                            <span className="fs-chip__label">{name}</span>
                            <button className="fs-chip__btn" title="Include" onClick={() => toggleInclude(name)}>+</button>
                            <button className="fs-chip__btn" title="Exclude" onClick={() => toggleExclude(name)}>−</button>
                        </div>
                    );
                })}
                {galleryNames.length === 0 && (
                    <p style={{fontSize: 12, color: "#888"}}>
                        No faces in gallery yet — add them in the Face Gallery panel.
                    </p>
                )}
            </div>
        </div>
    );
}

