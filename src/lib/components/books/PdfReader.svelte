<script lang="ts">
	/**
	 * The PDF reader: pdf.js behind the contract every book reader keeps
	 * (see `HtmlReader.svelte`): the same props, the same `goto`.
	 *
	 * Built for a 1,100-page, 100 MB book on a phone. The document is opened
	 * by URL with range requests and no prefetching, so opening page 412
	 * fetches what page 412 needs. Every page has a placeholder sized from
	 * page 1, so the scroll bar is true at once; an IntersectionObserver says
	 * which are on screen, and only those and two either side are drawn. A page
	 * that falls outside that window gives its canvas back (width and height
	 * 0, references dropped), so memory stays bounded however far you read.
	 *
	 * Fit to width is zoom 1. Zoom comes from the buttons, ctrl/cmd + wheel
	 * and a two-finger pinch. During a gesture the whole stack is scaled by a
	 * CSS transform for feedback; when it ends the zoom is committed, the
	 * stack re-laid out with the spot under the fingers kept in place, and the
	 * pages on screen redrawn sharp (the old drawing stays, stretched, until the
	 * new one is ready).
	 *
	 * Each drawn page has a pdf.js text layer so text can be selected, and a
	 * layer of marks under it: the highlights on that page, found by their
	 * words, and a search term from `goto(place, find)`.
	 *
	 * `onplace` is called once with the place the reader opened at, then each
	 * time the page occupying most of the screen changes. It is never called
	 * while the start place is still being applied. `goto` before the document
	 * has opened is remembered and used instead of `start`.
	 */
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
	import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask, TextLayer } from 'pdfjs-dist';
	import Icon from '$lib/components/Icon.svelte';
	import { describeLoadError } from '$lib/client/books/pdf-errors';
	import { findAll, findQuote, type TextMatch } from '$lib/client/books/pdf-marks';
	import { ZOOM_MAX, ZOOM_MIN, anchorAt, canvasRatio, clamp, layoutPages, mostVisiblePage, renderWindow, scrollForAnchor, scrollLeftForZoom, scrollShift } from '$lib/client/books/pdf-math';
	import type { BookManifest, Highlight, Place } from '$lib/shared/books';

	interface Props {
		id: string;
		manifest: BookManifest;
		/** Where to open: the place asked for in the URL, else the note's `at:`, else the start. */
		start: Place | null;
		highlights: Highlight[];
		/** Text size, 1 being the book's own. Only the HTML reader uses it; a PDF zooms instead. */
		fontScale: number;
		/** The reader moved: called as often as the place changes; the page debounces saving it. */
		onplace: (place: Place) => void;
		/** Text was selected (with where it is), or the selection went away. */
		onselect: (quote: string | null, place: Place | null) => void;
	}

	let { id, manifest, start, highlights, onplace, onselect }: Props = $props();

	/** Space above the first page, below the last and between pages, in CSS pixels. */
	const PAD = 8;
	/** Pages drawn beyond those on screen, each way; fewer when zoomed in, where pages are big. */
	const MARGIN = 2;
	const MARGIN_ZOOMED = 1;
	/** The most pixels one canvas may have; keeps a zoomed-in phone within memory. */
	const MAX_PIXELS = 5_000_000;
	/** Longest quote sent up from a selection, in characters. */
	const MAX_QUOTE = 1000;

	/** A drawing in progress for one page at one scale. */
	interface Job {
		scale: number;
		cancelled: boolean;
		task: RenderTask | null;
		text: TextLayer | null;
	}
	/** A page that is drawn or being drawn. `layers` is what shows now, at `scale`. */
	interface Entry {
		layers: HTMLElement | null;
		scale: number;
		text: TextLayer | null;
		job: Job | null;
	}

	let scroller = $state<HTMLDivElement>();
	let pagesEl = $state<HTMLDivElement>();

	let status = $state<'opening' | 'ready' | 'failed'>('opening');
	let problem = $state('');
	let pageCount = $state(0);
	/** Each page's size at scale 1, once known; the placeholder uses page 1's until then. */
	let sizes = $state<({ w: number; h: number } | null)[]>([]);
	let zoom = $state(1);
	let viewW = $state(0);
	let viewH = $state(0);
	/** Pages being fetched or drawn for the first time, and pages with a drawing on them. */
	const busy = new SvelteSet<number>();
	const drawn = new SvelteSet<number>();
	const failed = new SvelteSet<number>();
	let findTerm = $state('');

	const base = $derived(sizes[0] ?? null);
	const fit = $derived(base && viewW > 0 ? Math.max(0.05, (viewW - 2 * PAD) / base.w) : 1);
	/** CSS pixels per PDF point. */
	const scale = $derived(fit * zoom);
	const heights = $derived(Array.from({ length: pageCount }, (_, i) => (sizes[i] ?? base)!.h * scale));
	const widths = $derived(Array.from({ length: pageCount }, (_, i) => (sizes[i] ?? base)!.w * scale));
	const offsets = $derived(layoutPages(heights, PAD, PAD));

	// Not reactive: the machinery, not what is drawn.
	let doc: PDFDocumentProxy | null = null;
	let loadingTask: PDFDocumentLoadingTask | null = null;
	let TextLayerClass: typeof TextLayer | null = null;
	let observer: IntersectionObserver | null = null;
	const rendered = new Map<number, Entry>();
	const visible = new Set<number>();
	const pageEls: HTMLElement[] = [];
	/** The page (0-based) most on screen. */
	let current = 0;
	/** False until the start place is on screen; nothing is reported before. */
	let ready = false;
	/** A `goto` that came before the document was open. */
	let queued: { page: number } | null = null;
	/** Page (0-based) to scroll to the first search hit of, once it has been marked. */
	let scrollToHit: number | null = null;
	let frame = 0;
	let lastQuote: string | null = null;
	let selectionTimer: ReturnType<typeof setTimeout> | undefined;
	let gesture: { start: number; factor: number; cx: number; cy: number } | null = null;
	let gestureTimer: ReturnType<typeof setTimeout> | undefined;

	/** Show `place`, and when `find` is given, mark that term there and scroll to its first match. */
	export function goto(place: Place, find?: string): void {
		if (place.kind !== 'page') return;
		findTerm = find?.trim() ?? '';
		const page = Math.max(1, place.page);
		if (!ready) {
			queued = { page };
			return;
		}
		jumpTo(page - 1, !!findTerm);
	}

	function jumpTo(index: number, forHit: boolean) {
		if (!scroller) return;
		const i = clamp(index, 0, pageCount - 1);
		scrollToHit = forHit ? i : null;
		scroller.scrollTop = Math.max(0, offsets[i] - PAD);
		ensure(i);
		measure();
	}

	// ---- Opening the document -------------------------------------------------

	onMount(() => {
		let disposed = false;
		const cleanups: (() => void)[] = [];

		observer = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					const i = Number((e.target as HTMLElement).dataset.page) - 1;
					if (e.isIntersecting) visible.add(i);
					else visible.delete(i);
				}
				applyWindow();
			},
			{ root: scroller }
		);

		const resize = new ResizeObserver(() => {
			if (!scroller) return;
			viewH = scroller.clientHeight;
			if (scroller.clientWidth !== viewW) void relayout(scroller.clientWidth);
		});
		resize.observe(scroller!);
		viewW = scroller!.clientWidth;
		viewH = scroller!.clientHeight;

		cleanups.push(listen(document, 'selectionchange', () => {
			clearTimeout(selectionTimer);
			selectionTimer = setTimeout(readSelection, 200);
		}));
		cleanups.push(listen(document, 'pointerup', () => scroller?.querySelectorAll('.textLayer.selecting').forEach((t) => t.classList.remove('selecting'))));
		cleanups.push(listen(scroller!, 'wheel', onWheel as EventListener, { passive: false }));
		cleanups.push(listen(scroller!, 'touchstart', onTouchStart as EventListener, { passive: true }));
		cleanups.push(listen(scroller!, 'touchmove', onTouchMove as EventListener, { passive: false }));
		cleanups.push(listen(scroller!, 'touchend', onTouchEnd as EventListener));
		cleanups.push(listen(scroller!, 'touchcancel', onTouchEnd as EventListener));

		void (async () => {
			try {
				const pdfjs = await import('pdfjs-dist');
				if (disposed) return;
				pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
				TextLayerClass = pdfjs.TextLayer;
				loadingTask = pdfjs.getDocument({
					url: `/books/${id}/file`,
					disableAutoFetch: true,
					disableStream: true,
					rangeChunkSize: 262144,
					// Served by the `pdfjs-data` plugin in vite.config.ts.
					cMapUrl: '/pdfjs/cmaps/',
					cMapPacked: true,
					standardFontDataUrl: '/pdfjs/standard_fonts/',
					iccUrl: '/pdfjs/iccs/',
					wasmUrl: '/pdfjs/wasm/'
				});
				const opened = await loadingTask.promise;
				// Cleanup has already destroyed the loading task, and the document with it.
				if (disposed) return;
				doc = opened;
				const first = await opened.getPage(1);
				const v = first.getViewport({ scale: 1 });
				first.cleanup();
				if (disposed) return;
				viewW = scroller!.clientWidth;
				viewH = scroller!.clientHeight;
				sizes = Array.from({ length: opened.numPages }, (_, i) => (i === 0 ? { w: v.width, h: v.height } : null));
				pageCount = opened.numPages;
				status = 'ready';
				await tick();
				const wanted = queued?.page ?? (start?.kind === 'page' ? start.page : 1);
				queued = null;
				const i = clamp(wanted - 1, 0, pageCount - 1);
				scroller!.scrollTop = Math.max(0, offsets[i] - PAD);
				current = i;
				ready = true;
				scrollToHit = findTerm ? i : null;
				ensure(i);
				onplace({ kind: 'page', page: i + 1 });
			} catch (err) {
				if (disposed) return;
				status = 'failed';
				problem = describeLoadError(err);
			}
		})();

		return () => {
			disposed = true;
			clearTimeout(selectionTimer);
			clearTimeout(gestureTimer);
			cancelAnimationFrame(frame);
			for (const undo of cleanups) undo();
			resize.disconnect();
			observer?.disconnect();
			for (const i of [...rendered.keys()]) release(i);
			void loadingTask?.destroy();
			doc = null;
		};
	});

	function listen(target: EventTarget, type: string, handler: EventListener, options?: AddEventListenerOptions): () => void {
		target.addEventListener(type, handler, options);
		return () => target.removeEventListener(type, handler, options);
	}

	/** Svelte action: tell the observer about a page's element, and remember it. */
	function watch(node: HTMLElement, index: number) {
		pageEls[index] = node;
		observer?.observe(node);
		return {
			destroy() {
				observer?.unobserve(node);
				visible.delete(index);
				delete pageEls[index];
			}
		};
	}

	// ---- Which pages are drawn -----------------------------------------------

	/** Draw the pages near the screen, nearest first, and release the rest. */
	function applyWindow() {
		if (!doc || visible.size === 0) return;
		let first = Infinity;
		let last = -1;
		for (const i of visible) {
			first = Math.min(first, i);
			last = Math.max(last, i);
		}
		const w = renderWindow(first, last, pageCount, zoom > 2 ? MARGIN_ZOOMED : MARGIN);
		const order: number[] = [];
		for (let i = w.from; i <= w.to; i++) order.push(i);
		order.sort((a, b) => Math.abs(a - current) - Math.abs(b - current));
		for (const i of order) ensure(i);
		for (const i of [...rendered.keys()]) if (i < w.from || i > w.to) release(i);
	}

	/** Make sure page `i` is, or is becoming, drawn at the current scale. */
	function ensure(i: number) {
		if (!doc || i < 0 || i >= pageCount) return;
		const e = rendered.get(i);
		const same = (s: number) => Math.abs(s - scale) < 1e-6;
		if (e?.job && same(e.job.scale)) return;
		if (e && !e.job && e.layers && same(e.scale)) return;
		void draw(i);
	}

	/** Give page `i`'s memory back: cancel its drawing, empty its canvas, drop it. */
	function release(i: number) {
		const e = rendered.get(i);
		if (!e) return;
		e.job?.task?.cancel();
		e.job?.text?.cancel();
		if (e.job) e.job.cancelled = true;
		if (e.layers) dispose(e.layers);
		rendered.delete(i);
		drawn.delete(i);
		busy.delete(i);
		failed.delete(i);
	}

	function dispose(layers: HTMLElement) {
		for (const c of layers.querySelectorAll('canvas')) {
			c.width = 0;
			c.height = 0;
		}
		layers.remove();
	}

	/** Draw page `i` at the current scale into new layers, then swap them in for the old. */
	async function draw(i: number) {
		const open = doc;
		const TextLayerCls = TextLayerClass;
		if (!open || !TextLayerCls) return;
		const entry: Entry = rendered.get(i) ?? { layers: null, scale: 0, text: null, job: null };
		entry.job?.task?.cancel();
		entry.job?.text?.cancel();
		if (entry.job) entry.job.cancelled = true;
		const job: Job = { scale, cancelled: false, task: null, text: null };
		entry.job = job;
		rendered.set(i, entry);
		failed.delete(i);
		if (!entry.layers) busy.add(i);
		let layers: HTMLElement | null = null;
		try {
			const page = await open.getPage(i + 1);
			if (job.cancelled) return;
			const v1 = page.getViewport({ scale: 1 });
			noteSize(i, v1.width, v1.height);
			const viewport = page.getViewport({ scale: job.scale });
			const ratio = canvasRatio(viewport.width, viewport.height, window.devicePixelRatio, 2, MAX_PIXELS);

			layers = document.createElement('div');
			layers.className = 'layers';
			layers.style.width = `${viewport.width}px`;
			layers.style.height = `${viewport.height}px`;
			const canvas = document.createElement('canvas');
			canvas.width = Math.max(1, Math.floor(viewport.width * ratio));
			canvas.height = Math.max(1, Math.floor(viewport.height * ratio));
			const marks = document.createElement('div');
			marks.className = 'marks';
			const textDiv = document.createElement('div');
			textDiv.className = 'textLayer';
			textDiv.style.setProperty('--total-scale-factor', String(viewport.scale));
			textDiv.style.setProperty('--scale-round-x', '1px');
			textDiv.style.setProperty('--scale-round-y', '1px');
			textDiv.addEventListener('pointerdown', () => textDiv.classList.add('selecting'));
			layers.append(canvas, marks, textDiv);

			job.task = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
			await job.task.promise;
			if (job.cancelled) return dispose(layers);
			const text = new TextLayerCls({ textContentSource: page.streamTextContent(), container: textDiv, viewport });
			job.text = text;
			await text.render();
			if (job.cancelled) return dispose(layers);
			const end = document.createElement('div');
			end.className = 'endOfContent';
			textDiv.append(end);
			page.cleanup();

			const slot = pageEls[i]?.firstElementChild;
			if (!slot) return dispose(layers);
			if (entry.layers) dispose(entry.layers);
			slot.append(layers);
			entry.layers = layers;
			entry.scale = job.scale;
			entry.text = text;
			entry.job = null;
			layers = null;
			drawn.add(i);
			restyle(i);
			drawMarks(i);
		} catch (err) {
			if (layers) dispose(layers);
			if (job.cancelled || (err as { name?: string })?.name === 'RenderingCancelledException') return;
			if (entry.job === job) entry.job = null;
			if (!entry.layers) failed.add(i);
		} finally {
			busy.delete(i);
		}
	}

	/** Page `i` turned out to be `w` x `h` points: record it, and keep the screen still if it is above it. */
	function noteSize(i: number, w: number, h: number) {
		const known = sizes[i];
		if (known && Math.abs(known.w - w) < 0.01 && Math.abs(known.h - h) < 0.01) return;
		const oldH = heights[i];
		const top = offsets[i];
		sizes[i] = { w, h };
		const shift = scrollShift(top, oldH, scroller?.scrollTop ?? 0, h * scale - oldH);
		if (shift !== 0) {
			void tick().then(() => {
				if (scroller) scroller.scrollTop += shift;
			});
		}
	}

	/** Stretch page `i`'s drawing, if it is from another scale, to the page's size. */
	function restyle(i: number) {
		const e = rendered.get(i);
		if (!e?.layers) return;
		const k = scale / e.scale;
		e.layers.style.transform = Math.abs(k - 1) < 1e-6 ? '' : `scale(${k})`;
	}

	/** Redraw what is on screen after the scale changed. */
	function refresh() {
		for (const i of rendered.keys()) restyle(i);
		applyWindow();
		measure();
	}

	// ---- The current page ----------------------------------------------------

	function measure() {
		if (frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			if (!scroller || !ready) return;
			const i = mostVisiblePage(offsets, heights, scroller.scrollTop, viewH);
			if (i === null || i === current) return;
			current = i;
			onplace({ kind: 'page', page: i + 1 });
		});
	}

	// ---- Zoom ----------------------------------------------------------------

	async function relayout(width: number) {
		if (!scroller || !ready) {
			viewW = width;
			return;
		}
		const a = anchorAt(offsets, heights, scroller.scrollTop);
		viewW = width;
		await tick();
		scroller.scrollTop = scrollForAnchor(offsets, heights, a, 0);
		refresh();
	}

	/** Set the zoom, keeping the spot `cx`, `cy` pixels in from the window's corner where it is. */
	async function setZoom(next: number, cx: number, cy: number) {
		const target = clamp(next, ZOOM_MIN, ZOOM_MAX);
		if (!scroller || !pagesEl || !ready || Math.abs(target - zoom) < 1e-6) return;
		const oldScale = scale;
		const oldWidth = pagesEl.offsetWidth;
		const a = anchorAt(offsets, heights, scroller.scrollTop + cy);
		const left = scroller.scrollLeft;
		zoom = target;
		await tick();
		const ratio = scale / oldScale;
		scroller.scrollTop = scrollForAnchor(offsets, heights, a, cy);
		scroller.scrollLeft = scrollLeftForZoom(left, cx, oldWidth, pagesEl.offsetWidth, ratio);
		refresh();
	}

	function zoomBy(factor: number) {
		if (!scroller) return;
		void setZoom(zoom * factor, scroller.clientWidth / 2, scroller.clientHeight / 2);
	}

	/** Scale the stack on screen by `factor` of the zoom the gesture began at, about `cx`, `cy`. */
	function previewZoom(factor: number, cx: number, cy: number, keepOrigin: boolean) {
		if (!scroller || !pagesEl || !ready) return;
		if (!gesture) {
			gesture = { start: zoom, factor: 1, cx, cy };
			pagesEl.style.willChange = 'transform';
		} else if (!keepOrigin) {
			gesture.cx = cx;
			gesture.cy = cy;
		}
		gesture.factor = clamp(factor, ZOOM_MIN / gesture.start, ZOOM_MAX / gesture.start);
		pagesEl.style.transformOrigin = `${scroller.scrollLeft + gesture.cx}px ${scroller.scrollTop + gesture.cy}px`;
		pagesEl.style.transform = `scale(${gesture.factor})`;
	}

	/** End the gesture: take the previewed zoom for real. */
	function commitZoom() {
		clearTimeout(gestureTimer);
		const g = gesture;
		gesture = null;
		if (!g || !pagesEl) return;
		pagesEl.style.transform = '';
		pagesEl.style.willChange = '';
		void setZoom(g.start * g.factor, g.cx, g.cy);
	}

	function onWheel(e: WheelEvent) {
		if (!e.ctrlKey && !e.metaKey) return;
		e.preventDefault();
		const r = scroller!.getBoundingClientRect();
		previewZoom((gesture?.factor ?? 1) * Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top, true);
		clearTimeout(gestureTimer);
		gestureTimer = setTimeout(commitZoom, 180);
	}

	let pinchStart = 0;

	function pinchOf(e: TouchEvent) {
		const [a, b] = [e.touches[0], e.touches[1]];
		const r = scroller!.getBoundingClientRect();
		return { distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), cx: (a.clientX + b.clientX) / 2 - r.left, cy: (a.clientY + b.clientY) / 2 - r.top };
	}

	function onTouchStart(e: TouchEvent) {
		if (e.touches.length !== 2) return;
		pinchStart = pinchOf(e).distance;
		// Stop the browser's own panning for the rest of the pinch.
		scroller!.style.overflow = 'hidden';
	}

	function onTouchMove(e: TouchEvent) {
		if (e.touches.length !== 2 || !pinchStart) return;
		if (e.cancelable) e.preventDefault();
		const p = pinchOf(e);
		previewZoom(p.distance / pinchStart, p.cx, p.cy, true);
	}

	function onTouchEnd(e: TouchEvent) {
		if (!pinchStart || e.touches.length >= 2) return;
		pinchStart = 0;
		scroller!.style.overflow = '';
		commitZoom();
	}

	// ---- Selection -----------------------------------------------------------

	function readSelection() {
		const send = (quote: string | null, page = 0) => {
			if (quote === lastQuote) return;
			lastQuote = quote;
			if (quote === null) onselect(null, null);
			else onselect(quote, { kind: 'page', page });
		};
		const sel = document.getSelection();
		if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !scroller) return send(null);
		const node = sel.getRangeAt(0).startContainer;
		const el = node instanceof Element ? node : node.parentElement;
		const pageEl = el?.closest<HTMLElement>('[data-page]');
		if (!pageEl || !scroller.contains(pageEl)) return send(null);
		const quote = sel.toString().replace(/\s+/g, ' ').trim().slice(0, MAX_QUOTE);
		if (!quote) return send(null);
		send(quote, Number(pageEl.dataset.page));
	}

	// ---- Marks ---------------------------------------------------------------

	/** Redraw page `i`'s marks: its highlights, and the search term. */
	function drawMarks(i: number) {
		const e = rendered.get(i);
		const marks = e?.layers?.querySelector<HTMLElement>('.marks');
		if (!e || !e.layers || !e.text || !marks) return;
		marks.replaceChildren();
		const items = e.text.textContentItemsStr;
		const divs = e.text.textDivs;
		const layersBox = e.layers.getBoundingClientRect();
		const k = e.layers.offsetWidth ? layersBox.width / e.layers.offsetWidth : 1;

		const add = (m: TextMatch, kind: 'hl' | 'find'): HTMLElement | null => {
			const range = document.createRange();
			const at = (p: { item: number; offset: number }): [Node, number] => {
				const span = divs[p.item];
				const text = span?.firstChild;
				return text && text.nodeType === Node.TEXT_NODE ? [text, Math.min(p.offset, (text as Text).length)] : [span, 0];
			};
			try {
				range.setStart(...at(m.start));
				range.setEnd(...at(m.end));
			} catch {
				return null;
			}
			let firstBox: HTMLElement | null = null;
			for (const r of range.getClientRects()) {
				if (r.width < 1 || r.height < 1) continue;
				const box = document.createElement('div');
				box.className = `mark ${kind}`;
				box.style.left = `${(r.left - layersBox.left) / k}px`;
				box.style.top = `${(r.top - layersBox.top) / k}px`;
				box.style.width = `${r.width / k}px`;
				box.style.height = `${r.height / k}px`;
				marks.append(box);
				firstBox ??= box;
			}
			return firstBox;
		};

		for (const h of untrack(() => highlights)) {
			if (h.place.kind !== 'page' || h.place.page !== i + 1) continue;
			const m = findQuote(items, h.quote);
			if (m) add(m, 'hl');
		}
		let hit: HTMLElement | null = null;
		const term = untrack(() => findTerm);
		if (term) for (const m of findAll(items, term)) hit ??= add(m, 'find');
		if (scrollToHit === i) {
			scrollToHit = null;
			if (hit) bringIntoView(hit);
		}
	}

	/** Scroll so `el` is in the upper part of the window, if it is not comfortably on screen. */
	function bringIntoView(el: HTMLElement) {
		if (!scroller) return;
		const s = scroller.getBoundingClientRect();
		const r = el.getBoundingClientRect();
		if (r.top < s.top + viewH * 0.1 || r.bottom > s.bottom - viewH * 0.2) scroller.scrollTop += r.top - s.top - viewH * 0.3;
		if (r.left < s.left || r.right > s.right) scroller.scrollLeft += r.left - s.left - scroller.clientWidth * 0.3;
	}

	// Highlights added, or the search term changed: redraw the marks on what is drawn.
	$effect(() => {
		void highlights;
		void findTerm;
		untrack(() => {
			for (const i of rendered.keys()) drawMarks(i);
		});
	});
</script>

<div class="reader" data-testid="pdf-reader">
	<div class="scroller" bind:this={scroller} onscroll={measure} data-testid="pdf-scroller">
		<div class="pages" bind:this={pagesEl}>
			{#each { length: pageCount } as _, i (i)}
				<div class="page" data-page={i + 1} use:watch={i} style:width="{widths[i]}px" style:height="{heights[i]}px">
					<div class="slot"></div>
					{#if !drawn.has(i)}
						<span class="note" class:bad={failed.has(i)}>
							{#if failed.has(i)}Page {i + 1} could not be drawn. Scroll away and back to try again.{:else if busy.has(i)}Loading page {(i + 1).toLocaleString('en-GB')}…{:else}Page {(i + 1).toLocaleString('en-GB')}{/if}
						</span>
					{/if}
				</div>
			{/each}
		</div>
	</div>

	{#if status === 'opening'}
		<p class="status" role="status" data-testid="pdf-opening">Opening the book…</p>
	{:else if status === 'failed'}
		<div class="status bad" role="alert" data-testid="pdf-error">
			<p>{problem}</p>
			<a href="/books">Back to Books</a>
		</div>
	{/if}

	{#if status === 'ready'}
		<div class="zoom" role="group" aria-label="Zoom">
			<button class="icon-btn" onclick={() => zoomBy(1 / 1.25)} disabled={zoom <= ZOOM_MIN} aria-label="Zoom out" data-testid="zoom-out"><Icon name="minus" size={18} /></button>
			<button class="level" onclick={() => setZoom(1, (scroller?.clientWidth ?? 0) / 2, (scroller?.clientHeight ?? 0) / 2)} aria-label="Fit to width" title="Fit to width" data-testid="zoom-level">{Math.round(zoom * 100)}%</button>
			<button class="icon-btn" onclick={() => zoomBy(1.25)} disabled={zoom >= ZOOM_MAX} aria-label="Zoom in" data-testid="zoom-in"><Icon name="plus" size={18} /></button>
		</div>
	{/if}
</div>

<style>
	.reader {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
	}
	.scroller {
		position: absolute;
		inset: 0;
		overflow: auto;
		background: var(--soft);
		/* Scroll position is kept by the reader, which knows page sizes change. */
		overflow-anchor: none;
		/* Pinch is the reader's own, so the browser must not zoom the whole page. */
		touch-action: pan-x pan-y;
		overscroll-behavior: contain;
		/* Keeps the text layers' z-index from reaching over the controls beside it. */
		isolation: isolate;
	}
	.pages {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 8px;
		width: max-content;
		min-width: 100%;
		box-sizing: border-box;
	}
	.page {
		position: relative;
		flex: none;
		overflow: hidden;
		background: var(--panel);
		box-shadow: var(--shadow);
	}
	.slot {
		position: absolute;
		inset: 0;
	}
	.note {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: var(--s4);
		text-align: center;
		color: var(--muted);
		font-size: var(--t14);
		pointer-events: none;
	}
	.note.bad {
		color: var(--bad);
	}

	.status {
		z-index: 3;
		position: absolute;
		top: var(--s4);
		left: 50%;
		transform: translateX(-50%);
		margin: 0;
		max-width: calc(100% - 2 * var(--s4));
		padding: var(--s2) var(--s4);
		border-radius: var(--r-pill);
		background: var(--panel);
		border: 1px solid var(--line);
		box-shadow: var(--shadow);
		color: var(--muted);
		font-size: var(--t14);
	}
	.status.bad {
		border-radius: var(--r-lg);
		border-color: var(--bad);
		color: var(--text);
		background: var(--bad-soft);
		text-align: center;
	}
	.status.bad p {
		margin: 0 0 var(--s1);
	}

	.zoom {
		z-index: 3;
		position: absolute;
		top: var(--s3);
		right: var(--s3);
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 2px;
		border-radius: var(--r-pill);
		background: var(--panel);
		border: 1px solid var(--line);
		box-shadow: var(--shadow);
		opacity: 0.92;
	}
	/* On a phone the top of a page is where reading starts, and a thumb reaches the bottom; pinching is the usual way anyway. */
	@media (max-width: 720px) {
		.zoom {
			top: auto;
			bottom: var(--s3);
			right: var(--s3);
			opacity: 0.8;
		}
	}
	.zoom .icon-btn {
		width: 36px;
		height: 36px;
		border-radius: 50%;
	}
	.zoom .icon-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.level {
		min-width: 48px;
		height: 36px;
		border: 0;
		background: none;
		border-radius: var(--r-pill);
		color: var(--text);
		font: inherit;
		font-size: var(--t13);
		cursor: pointer;
	}
	.level:hover {
		background: var(--soft);
	}

	/*
	 * What the reader builds by hand: a page's drawing, its marks and pdf.js's
	 * text layer. pdf.js ships these rules in its viewer stylesheet, which is
	 * mostly for parts of the viewer this reader does not have; the few the
	 * text layer needs are here, so the stylesheet need not be loaded.
	 */
	.scroller :global(.layers) {
		position: absolute;
		left: 0;
		top: 0;
		transform-origin: 0 0;
	}
	.scroller :global(.layers canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}
	.scroller :global(.marks) {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.scroller :global(.mark) {
		position: absolute;
		mix-blend-mode: multiply;
		border-radius: 2px;
	}
	/* The page is white paper in either theme, so marks are the theme's amber and teal at a see-through strength. */
	.scroller :global(.mark.find) {
		background: color-mix(in srgb, var(--q3) 60%, transparent);
	}
	.scroller :global(.mark.hl) {
		background: color-mix(in srgb, var(--accent) 38%, transparent);
	}

	.scroller :global(.textLayer) {
		position: absolute;
		inset: 0;
		overflow: clip;
		text-align: initial;
		line-height: 1;
		letter-spacing: normal;
		word-spacing: normal;
		-webkit-text-size-adjust: none;
		text-size-adjust: none;
		transform-origin: 0 0;
		z-index: 2;
		--min-font-size: 1;
		--text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size));
		--min-font-size-inv: calc(1 / var(--min-font-size));
	}
	.scroller :global(.textLayer :is(span, br)) {
		color: transparent;
		position: absolute;
		white-space: pre;
		cursor: text;
		transform-origin: 0% 0%;
		-webkit-user-select: text;
		user-select: text;
	}
	.scroller :global(.textLayer > :not(.markedContent)),
	.scroller :global(.textLayer .markedContent span:not(.markedContent)) {
		z-index: 1;
		--font-height: 0;
		font-size: calc(var(--text-scale-factor) * var(--font-height));
		--scale-x: 1;
		--rotate: 0deg;
		transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv));
	}
	.scroller :global(.textLayer .markedContent) {
		display: contents;
	}
	.scroller :global(.textLayer span[role='img']) {
		-webkit-user-select: none;
		user-select: none;
		cursor: default;
	}
	.scroller :global(.textLayer ::selection) {
		background: color-mix(in srgb, var(--accent) 35%, transparent);
		color: transparent;
	}
	.scroller :global(.textLayer .endOfContent) {
		display: block;
		position: absolute;
		inset: 100% 0 0;
		z-index: 0;
		cursor: default;
		-webkit-user-select: none;
		user-select: none;
	}
	.scroller :global(.textLayer.selecting .endOfContent) {
		top: 0;
	}
</style>
