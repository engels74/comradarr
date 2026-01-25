import { insertLogBatch } from './queries';
import type { PersistedLogEntry } from './types';

const BATCH_SIZE = 100;
const FLUSH_INTERVAL_MS = 5000;

interface WriterState {
	buffer: PersistedLogEntry[];
	flushTimer: ReturnType<typeof setTimeout> | null;
	isShuttingDown: boolean;
	enabled: boolean;
}

declare global {
	var __logPersistenceWriterState: WriterState | undefined;
}

function getWriterState(): WriterState {
	if (!globalThis.__logPersistenceWriterState) {
		globalThis.__logPersistenceWriterState = {
			buffer: [],
			flushTimer: null,
			isShuttingDown: false,
			enabled: false
		};
	}
	return globalThis.__logPersistenceWriterState;
}

function scheduleFlush(): void {
	const state = getWriterState();

	if (state.flushTimer || state.isShuttingDown) {
		return;
	}

	state.flushTimer = setTimeout(() => {
		state.flushTimer = null;
		flushBuffer().catch(() => {});
	}, FLUSH_INTERVAL_MS);
}

async function flushBuffer(): Promise<number> {
	const state = getWriterState();

	if (state.buffer.length === 0) {
		return 0;
	}

	const entriesToFlush = state.buffer.splice(0, state.buffer.length);

	try {
		const inserted = await insertLogBatch(entriesToFlush);
		return inserted;
	} catch {
		return 0;
	}
}

export function enableLogPersistence(): void {
	const state = getWriterState();
	state.enabled = true;
}

export function disableLogPersistence(): void {
	const state = getWriterState();
	state.enabled = false;
}

export function isLogPersistenceEnabled(): boolean {
	return getWriterState().enabled;
}

export function add(entry: PersistedLogEntry): void {
	const state = getWriterState();

	if (!state.enabled || state.isShuttingDown) {
		return;
	}

	state.buffer.push(entry);

	if (state.buffer.length >= BATCH_SIZE) {
		if (state.flushTimer) {
			clearTimeout(state.flushTimer);
			state.flushTimer = null;
		}
		flushBuffer().catch(() => {});
	} else {
		scheduleFlush();
	}
}

export async function flush(): Promise<number> {
	const state = getWriterState();

	if (state.flushTimer) {
		clearTimeout(state.flushTimer);
		state.flushTimer = null;
	}

	return flushBuffer();
}

export async function shutdown(): Promise<number> {
	const state = getWriterState();
	state.isShuttingDown = true;

	if (state.flushTimer) {
		clearTimeout(state.flushTimer);
		state.flushTimer = null;
	}

	const flushed = await flushBuffer();

	state.isShuttingDown = false;

	return flushed;
}

export function getBufferStats(): { pending: number; enabled: boolean } {
	const state = getWriterState();
	return {
		pending: state.buffer.length,
		enabled: state.enabled
	};
}
