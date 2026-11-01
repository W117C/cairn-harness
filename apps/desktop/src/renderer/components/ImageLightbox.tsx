// 图片灯箱（2026-10-31）：移植自 open-claude-ui `MediaLightboxViewer`（MIT，
// 出处见 `src/renderer/vendor/open-claude-ui/UPSTREAM.json`）。只取交互物理：
// 光标锚定缩放、放大后拖拽平移、双击 1x/2x、键盘 +/-/0、Esc 关闭、焦点陷阱。
// 不引入 Tailwind / Framer：样式走本仓 tokens，动效走 CSS。
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { STR } from "../strings";
import { ModalSurface } from "./ModalSurface";

export const LIGHTBOX_MIN_SCALE = 1;
export const LIGHTBOX_MAX_SCALE = 4;

/** 缩放档位钳制；非有限值回到 1x。 */
export function clampLightboxScale(scale: number): number {
  if (Number.isNaN(scale)) return LIGHTBOX_MIN_SCALE;
  return Math.min(LIGHTBOX_MAX_SCALE, Math.max(LIGHTBOX_MIN_SCALE, scale));
}

/** 光标锚定缩放：指针下的像素在缩放前后保持不动（参考库的仿射方程）。 */
export function anchoredOffset(pointer: number, offset: number, fromScale: number, toScale: number): number {
  if (fromScale <= 0) return offset;
  return pointer - (pointer - offset) * (toScale / fromScale);
}

export interface GalleryItem { src: string; alt: string }

/** 画廊索引（纯函数）：单图恒 0；多图首尾环绕。 */
export function galleryStep(index: number, length: number, delta: -1 | 1): number {
  if (length <= 1) return 0;
  return (index + delta + length) % length;
}

/** 平移钳制：把图钉在视口里，放大后可以拖到边缘但不拖飞。 */
export function clampLightboxOffset(value: number, viewport: number, content: number, scale: number): number {
  const max = Math.max(0, (content * scale - viewport) / 2);
  return Math.min(max, Math.max(-max, value));
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  tx: number;
  ty: number;
}

export interface ImageLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function ImageLightbox(props: ImageLightboxProps): React.JSX.Element {
  const [scale, setScale] = useState(LIGHTBOX_MIN_SCALE);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [dragging, setDragging] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const stateRef = useRef({ scale, tx, ty });
  stateRef.current = { scale, tx, ty };
  const reset = useCallback((): void => {
    stateRef.current = { scale: LIGHTBOX_MIN_SCALE, tx: 0, ty: 0 };
    setScale(LIGHTBOX_MIN_SCALE);
    setTx(0);
    setTy(0);
  }, []);

  // 同一条消息里的多张图组成画廊（参考库 MediaLightboxViewer）；外部图仍只有过了门闩的才有 img。
  const gallery = useMemo<readonly GalleryItem[]>(() => {
    const fallback: GalleryItem[] = [{ src: props.src, alt: props.alt }];
    if (typeof document === "undefined") return fallback;
    // 只收打开图所在消息的 .md-body：侧栏预览/侧聊的图不属于这场对话的画廊。
    const opener = props.returnFocusRef?.current ?? null;
    const root = opener?.closest(".md-body") ?? document;
    const seen = new Set<string>();
    const items: GalleryItem[] = [];
    for (const img of root.querySelectorAll<HTMLImageElement>(".md-img-open img")) {
      const src = img.currentSrc || img.src;
      if (src === "" || seen.has(src)) continue;
      seen.add(src);
      items.push({ src, alt: img.alt });
    }
    if (!seen.has(props.src)) items.unshift({ src: props.src, alt: props.alt });
    return items.length > 0 ? items : fallback;
  }, [props.src, props.alt, props.returnFocusRef]);
  const [index, setIndex] = useState<number>(() => Math.max(0, gallery.findIndex((item) => item.src === props.src)));
  const current = gallery[Math.min(index, gallery.length - 1)] ?? { src: props.src, alt: props.alt };
  const go = useCallback((delta: -1 | 1): void => {
    if (gallery.length <= 1) return;
    setIndex((i) => galleryStep(i, gallery.length, delta));
    reset();
  }, [gallery.length, reset]);

  const applyZoom = useCallback((nextScale: number, pointerX: number, pointerY: number): void => {
    const current = stateRef.current;
    const target = clampLightboxScale(nextScale);
    if (target === current.scale) return;
    if (target === LIGHTBOX_MIN_SCALE) {
      reset();
      return;
    }
    const viewport = viewportRef.current;
    const image = imageRef.current;
    const nextTx = clampLightboxOffset(anchoredOffset(pointerX, current.tx, current.scale, target), viewport?.clientWidth ?? 0, image?.clientWidth ?? 0, target);
    const nextTy = clampLightboxOffset(anchoredOffset(pointerY, current.ty, current.scale, target), viewport?.clientHeight ?? 0, image?.clientHeight ?? 0, target);
    // 同一 tick 里的连续缩放（滚轮一串事件 / 双击连点）读的是上一次渲染的 state；
    // 这里先把权威值写回 ref，下一次调用才不会从旧档位重算。
    stateRef.current = { scale: target, tx: nextTx, ty: nextTy };
    setScale(target);
    setTx(nextTx);
    setTy(nextTy);
  }, [reset]);

  const zoomAtCenter = useCallback((factor: number): void => {
    applyZoom(stateRef.current.scale * factor, 0, 0);
  }, [applyZoom]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const pointerX = e.clientX - rect.left - rect.width / 2;
      const pointerY = e.clientY - rect.top - rect.height / 2;
      applyZoom(stateRef.current.scale * Math.exp(-e.deltaY * 0.0015), pointerX, pointerY);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomAtCenter(1.25); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomAtCenter(1 / 1.25); }
      else if (e.key === "0") { e.preventDefault(); reset(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, reset, zoomAtCenter]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (stateRef.current.scale <= LIGHTBOX_MIN_SCALE || e.button !== 0) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      tx: stateRef.current.tx,
      ty: stateRef.current.ty,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== e.pointerId) return;
    const viewport = viewportRef.current;
    const image = imageRef.current;
    const nextTx = clampLightboxOffset(drag.tx + (e.clientX - drag.startX), viewport?.clientWidth ?? 0, image?.clientWidth ?? 0, stateRef.current.scale);
    const nextTy = clampLightboxOffset(drag.ty + (e.clientY - drag.startY), viewport?.clientHeight ?? 0, image?.clientHeight ?? 0, stateRef.current.scale);
    stateRef.current = { ...stateRef.current, tx: nextTx, ty: nextTy };
    setTx(nextTx);
    setTy(nextTy);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const toggleZoom = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const current = stateRef.current;
    if (current.scale > LIGHTBOX_MIN_SCALE) {
      reset();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    applyZoom(2, e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2);
  };

  const zoomed = scale > LIGHTBOX_MIN_SCALE;

  return createPortal(
    <ModalSurface
      className="img-lightbox"
      label={STR.markdown.imagePreview}
      onClose={props.onClose}
      initialFocusRef={closeRef}
      {...(props.returnFocusRef !== undefined ? { returnFocusRef: props.returnFocusRef } : {})}
      onClick={(e) => { if (e.target === e.currentTarget) props.onClose(); }}
    >
      <div className="il-shell" data-cds="MediaLightboxViewer">
        <div className="il-bar">
          <span className="il-title" title={current.alt}>
            {current.alt !== "" ? current.alt : STR.markdown.imagePreview}
          </span>
          {gallery.length > 1 && <span className="il-count" role="status" aria-live="polite">{String(index + 1)} / {String(gallery.length)}</span>}
          {gallery.length > 1 && (
            <>
              <button type="button" className="il-btn" aria-label={STR.markdown.imagePrev} title={STR.markdown.imagePrev} onClick={() => { go(-1); }}><ChevronLeft size={17} /></button>
              <button type="button" className="il-btn" aria-label={STR.markdown.imageNext} title={STR.markdown.imageNext} onClick={() => { go(1); }}><ChevronRight size={17} /></button>
            </>
          )}
          <span className="il-zoom">{String(Math.round(scale * 100))}%</span>
          <button
            type="button"
            className="il-btn"
            aria-label={STR.markdown.imageZoomOut}
            title={STR.markdown.imageZoomOut}
            disabled={!zoomed}
            onClick={() => { zoomAtCenter(1 / 1.25); }}
          ><ZoomOut size={16} /></button>
          <button
            type="button"
            className="il-btn"
            aria-label={STR.markdown.imageReset}
            title={STR.markdown.imageReset}
            disabled={!zoomed}
            onClick={reset}
          ><RotateCcw size={15} /></button>
          <button
            type="button"
            className="il-btn"
            aria-label={STR.markdown.imageZoomIn}
            title={STR.markdown.imageZoomIn}
            disabled={scale >= LIGHTBOX_MAX_SCALE}
            onClick={() => { zoomAtCenter(1.25); }}
          ><ZoomIn size={16} /></button>
          <button
            type="button"
            ref={closeRef}
            className="il-btn"
            aria-label={STR.markdown.imageClose}
            title={STR.markdown.imageClose}
            onClick={props.onClose}
          ><X size={17} /></button>
        </div>
        <div
          className="il-viewport"
          ref={viewportRef}
          data-zoomed={zoomed ? "true" : "false"}
          data-dragging={dragging ? "true" : "false"}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onDoubleClick={toggleZoom}
          onClick={(e) => {
            if (e.target === e.currentTarget && !dragging && !zoomed) props.onClose();
          }}
        >
          <img
            key={current.src}
            ref={imageRef}
            className="il-img"
            src={current.src}
            alt={current.alt}
            draggable={false}
            loading="eager"
            referrerPolicy="no-referrer"
            style={{ transform: `translate(${String(tx)}px, ${String(ty)}px) scale(${String(scale)})` }}
          />
        </div>
        <div className="il-hint">{STR.markdown.imageHint}</div>
      </div>
    </ModalSurface>,
    document.body,
  );
}
