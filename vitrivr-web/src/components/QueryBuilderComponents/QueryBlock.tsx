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
    faceGallery?: Record<string, number[]>;
};

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
                    <div className="fs-chips">
                        {Object.keys(faceGallery ?? {}).sort().map(name => {
                            const inc = (block.faceInclude ?? []).includes(name);
                            const exc = (block.faceExclude ?? []).includes(name);
                            return (
                                <div key={name} className={`fs-chip${inc ? " fs-chip--include" : ""}${exc ? " fs-chip--exclude" : ""}`}>
                                    <span className="fs-chip__label">{name}</span>
                                    <button className="fs-chip__btn" title="Include" onClick={() => {
                                        const next = inc
                                            ? (block.faceInclude ?? []).filter(n => n !== name)
                                            : [...(block.faceInclude ?? []), name];
                                        onChange({faceInclude: next, faceExclude: (block.faceExclude ?? []).filter(n => n !== name)});
                                    }}>+</button>
                                    <button className="fs-chip__btn" title="Exclude" onClick={() => {
                                        const next = exc
                                            ? (block.faceExclude ?? []).filter(n => n !== name)
                                            : [...(block.faceExclude ?? []), name];
                                        onChange({faceExclude: next, faceInclude: (block.faceInclude ?? []).filter(n => n !== name)});
                                    }}>−</button>
                                </div>
                            );
                        })}
                        {Object.keys(faceGallery ?? {}).length === 0 && (
                            <p style={{fontSize: 12, color: "#888"}}>No faces in gallery yet — add them in the Face Gallery panel.</p>
                        )}
                    </div>
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

