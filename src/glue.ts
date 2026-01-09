/*
 * Copyright 2019 Kopano and its contributors
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 */

'use strict';

export const API_VERSION = 0;

export interface IEmbeddOptions {
	timeout?: number;
	retries?: number;

	className?: string;
	attributes?: {[key: string]: string};
	sandboxRestrictions?: string;
	featurePolicy?: string;

	origin?: string;
	mode?: string;
	options?: {[key: string]: unknown};

	features?: {[key: string]: (...args: unknown[]) => unknown};
	events?: Array<string>;

	onFrame?: (frame: HTMLIFrameElement) => void;
	onBeforeInit?: (glue: Glue, cont: Promise<unknown>) => {[key: string]: unknown} | undefined; /* eslint-disable-line @typescript-eslint/no-explicit-any */
}

export interface IEnableOptions {
	timeout?: number;
	origins?: Array<string>;

	features?: {[key: string]: (...args: unknown[]) => unknown};
	events?: Array<string>;

	onInit?: (glue: Glue, initData: IInitData) => void; /* eslint-disable-line @typescript-eslint/no-explicit-any */
	onBeforeReady?: (glue: Glue, readyData: IReadyData) => void; /* eslint-disable-line @typescript-eslint/no-explicit-any */
}

export interface IPayload {
	v: number;
	glue: boolean;
	type: string;
	data: unknown;
	callbackId?: string;
}

export interface IInitData {
	features?: Array<string>;
	events?: Set<string>;
	mode?: string;
	options?: {[key: string]: unknown};
	error?: boolean;
}

export interface ICallbackData {
	callbackId: string;
	data: unknown;
	error?: boolean;
}

export interface IReadyData {
	ready: boolean;
	data?: unknown;
	error?: boolean;
}

export interface ICallData {
	action: string;
	args?: Array<unknown>;
}

export interface ICallbackRecord {
	resolve: (value?: unknown) => void;
	reject: (reason?: unknown) => void;
}

export interface IGlueEvent {
	type: string;
}

export interface IGlueEventData {
	event: IGlueEvent;
	args?: Array<unknown>;
}

export interface IGlueEventListenerRecord {
	listener: (...args: unknown[]) => void;
	options?: AddEventListenerOptions;
}

export type API<T> = {
	[P in keyof T]?: T[P]
}

/**
 * Glue holds together glue applications and their API.
 */
export class Glue {
	public static version: string = __VERSION__;

	public readonly enabled: boolean = false;
	public readonly api: API<{[key: string]: (...args: unknown[]) => Promise<any>}> /* eslint-disable-line @typescript-eslint/no-explicit-any */
	public readonly events: Array<string>;
	public readonly options: {[key: string]: unknown};
	public readonly mode?: string;

	public hidden = false; /* Default value, only used when the glue on the other has no support. */

	public dispatchEvent?: (event: IGlueEvent, ...args: unknown[]) => Promise<boolean>;
	public addEventListener?: (type: string, listener: (...args: unknown[]) => void, options?: AddEventListenerOptions) => void;
	public removeEventListener?: (type: string, listener: (...args: unknown[]) => void, options?: AddEventListenerOptions) => void;
	public destroy?: () => Promise<void>;

	public constructor(
		{
			api,
			events,
			options,
			mode,
		}: {
			api?: API<{[key: string]: (...args: unknown[]) => Promise<any>}>; /* eslint-disable-line @typescript-eslint/no-explicit-any */
			events?: Set<string>;
			mode?: string;
			options?: {[key: string]: unknown};
		}) {
		if (api === undefined) {
			api = {} as API<{[key: string]: (...args: unknown[]) => Promise<any>}>; /* eslint-disable-line @typescript-eslint/no-explicit-any */
		}
		this.api = api;
		this.events = events ? Array.from(events) : [];
		this.options = options ? options : {};
		this.mode = mode;
	}
}

/**
 * Controller implements the internal Glue functionality.
 */
export class Controller {
	private origin: string;

	private callbackCounter: number;
	private callbackTable: Map<string, ICallbackRecord>;
	private eventListenerCounter: number;
	private eventListenerTable: Map<string, Map<string, IGlueEventListenerRecord>>;

	private handler?: (message: IPayload) => Promise<any>; /* eslint-disable-line @typescript-eslint/no-explicit-any */
	private destructor?: () => Promise<void>;
	private events?: Set<string>;

	private window?: Window;
	private destroyed?: boolean;

	public constructor(
		{
			origin,
			handler,
			destructor,
			events,
		}: {
			origin: string;
			handler?: (message: IPayload) => Promise<unknown>;
			destructor?: () => Promise<void>;
			events?: Set<string>;
		}) {
		this.origin = origin ? origin : window.origin;

		this.callbackCounter = 0;
		this.callbackTable = new Map();
		this.eventListenerCounter = 0;
		this.eventListenerTable = new Map();

		this.handler = handler;
		this.destructor = destructor;
		this.events = events;

		window.addEventListener('message', this.handleMessageEvent, false);
	}

	public Glue({
		features,
		events,
		options,
		mode,
	}: {
		features?: Array<string>;
		events?: Set<string>;
		options?: {[key: string]: unknown};
		mode?: string;
	}): Glue {
		const api = {} as API<{[key: string]: (...args: unknown[]) => Promise<any>}>; /* eslint-disable-line @typescript-eslint/no-explicit-any */

		const state = {
			visibilityState: 'prerender',
			enabled: api !== undefined,
		};

		const glue =  new Glue({
			api,
			events,
			options,
			mode,
		});

		if (features) {
			for (const action of features) {
				switch (action) {
					default:
						// All the rest is call wrapper for API.
						api[action] = (...args: unknown[]): Promise<any> => { /* eslint-disable-line @typescript-eslint/no-explicit-any */
							return this.callAction(action, args);
						}
				}
			}
		}

		Object.defineProperty(glue, 'enabled', {
			get: (): boolean => {
				return state.enabled && !this.destroyed;
			},
		});


		glue.destroy = async (): Promise<void> => {
			if (this.destroyed) {
				return;
			}

			if (this.destructor) {
				await this.destructor();
			}

			window.removeEventListener('message', this.handleMessageEvent, false);

			this.destroyed = true;
			this.eventListenerTable.clear();
			this.callbackTable.clear();
			this.detach();
		}

		const addEventListener = (type: string, listener: (...args: unknown[]) => void, options?: EventListenerOptions): void => {
			if (this.destroyed) {
				throw new Error('glue is destroyed');
			}

			if (!this.eventListenerTable.has(type)) {
				this.eventListenerTable.set(type, new Map());
			}
			const listeners = this.eventListenerTable.get(type) as Map<string, IGlueEventListenerRecord>;
			const id = String(++this.eventListenerCounter);
			listeners.set(id, {
				listener,
				options,
			});
		}
		if (events) {
			glue.addEventListener = addEventListener;
			glue.removeEventListener = (type: string, listener?: (...args: unknown[]) => void, options?: EventListenerOptions): void => {
				const listeners = this.eventListenerTable.get(type);
				if (listeners) {
					if (listener) {
						for (const [id, record] of listeners) {
							if (record.listener === listener) {
								if (!options && !record.options) {
									listeners.delete(id);
									continue;
								}
								if (options && record.options) {
									// TODO(longsleep): What options shall we handle here?
									listeners.delete(id);
									continue;
								}
							}
						}
					} else {
						this.eventListenerTable.delete(type);
					}
					if (!listeners.size) {
						this.eventListenerTable.delete(type);
					}
				}
			}
		}

		const dispatchableEvents = this.events;
		const dispatchEvent = async (event: IGlueEvent, ...args: unknown[]): Promise<boolean> => {
			if (this.destroyed) {
				throw new Error('glue is destroyed');
			}
			if (!dispatchableEvents || !dispatchableEvents.has(event.type)) {
				throw new Error(`unknown event: ${event.type}`);
			}

			const message: IGlueEventData = {
				event,
				args,
			};

			await this.postMessage('event.dispatch', message);
			return true;
		};
		if (dispatchableEvents) {
			glue.dispatchEvent = dispatchEvent;
		}

		if (this.events && this.events.has('glue.visibilitychange')) {
			// NOTE(longsleep): visibilityState can be changed when .embed().
			Object.defineProperty(glue, 'hidden', {
				get: (): boolean => {
					return state.visibilityState !== 'visible';
				},
				set: (value: boolean): void => {
					const n = value ? 'hidden' : 'visible';
					if (n !== state.visibilityState) {
						state.visibilityState = n;
						dispatchEvent({
							type: 'glue.visibilitychange',
						}, state.visibilityState);
					}
				}
			});
		}
		if (events && events.has('glue.visibilitychange')) {
			// NOTE(longsleep): visibilityState is readonly when .enable().
			Object.defineProperty(glue, 'hidden', {
				get: (): boolean => {
					return state.visibilityState !== 'visible';
				},
			});
			addEventListener('glue.visibilitychange', ((event: unknown, value: unknown): void => {
				state.visibilityState = String(value);
			}));
		}

		return glue;
	}

	public attach(glueWindow: Window): void {
		if (this.destroyed) {
			throw new Error('glue is destroyed');
		}
		if (this.window !== undefined) {
			throw new Error('glue already attached');
		}

		this.window = glueWindow;
	}

	public detach(): void {
		this.window = undefined;
	}

	public postMessage = (type: string, data: unknown): Promise<any> => { /* eslint-disable-line @typescript-eslint/no-explicit-any */
		return new Promise((resolve, reject) => {
			if (this.window === undefined) {
				throw new Error('glue is not attached');
			}

			const message: IPayload = {
				v: API_VERSION,
				glue: true,
				type,
				data,
				callbackId: String(++this.callbackCounter),
			};
			const record: ICallbackRecord = {
				reject,
				resolve,
			};
			this.callbackTable.set(message.callbackId as string, record);
			this.window.postMessage(message, this.origin);
		});
	}

	private handleMessageEvent = (event: MessageEvent): void => {
		if (event.source !== this.window) {
			return;
		}
		if (event.origin !== "null" && event.origin !== this.origin) {
			return;
		}
		const message = event.data as IPayload;
		if (message.glue !== true || message.v === undefined || message.type === undefined) {
			return;
		}
		if (message.v > API_VERSION) {
			throw new Error(`glue versions incompatible: ${message.v} != ${API_VERSION}`);
		}

		this.handleMessage(message, event.origin);
	}

	private callAction = async (action: string, args: unknown[]): Promise<unknown> => {
		const message: ICallData = {
			action,
			args,
		};
		return this.postMessage('call', message);
	}

	private replyMessage = (callbackId: string, data: unknown): void => {
		const message: ICallbackData = {
			callbackId,
			data,
		}
		this.postMessage('callback', message);
	}

	private handleMessage = (message: IPayload, origin: string): void => {
		switch (message.type) {
			case 'init': {
				const data = message.data as IInitData;
				if (!message.callbackId) {
					throw new Error('glue init has no callbackId');
				}

				if (origin === 'null') {
					// If the message origin is 'null', we are getting a message
					// from a sandboxed iframe. It was already matched to be
					// from our expected window, so should be secure enough to
					// allow it as target origin for all further messages.
					this.origin = '*';
				}
				console.debug('glue initialized', data.features, this.origin);

				if (!this.handler) {
					return;
				}
				this.handler(message).then((reply: IInitData) => {
					this.replyMessage(message.callbackId as string, reply);
				});

				break;
			}

			case 'callback': {
				const data = message.data as ICallbackData;
				if (!data.callbackId) {
					throw new Error('glue callback has no callbackId');
				}

				const record = this.callbackTable.get(data.callbackId)
				if (record) {
					this.callbackTable.delete(data.callbackId);
					if (data.error) {
						record.reject(data.data);
					} else {
						record.resolve(data.data);
					}
				}

				break;
			}

			case 'call': {
				if (!message.callbackId) {
					throw new Error('glue call has no callbackId');
				}

				if (this.handler) {
					this.handler(message).then((reply: unknown) => {
						this.replyMessage(message.callbackId as string, reply);
					});
				}

				break;
			}

			case 'event.dispatch': {
				const data = message.data as IGlueEventData;
				if (!message.callbackId) {
					throw new Error('glue event.dispatch has no callbackId');
				}
				if (!data.event) {
					throw new Error('glue event.dispatch without event');
				}

				const listeners = this.eventListenerTable.get(data.event.type);
				if (listeners) {
					const args = data.args ? data.args : [];
					for (const [id, record] of listeners) {
						if (record.options && record.options.once) {
							listeners.delete(id);
						}
						record.listener(data.event, ...args);
					}
					if (!listeners.size) {
						this.eventListenerTable.delete(data.event.type);
					}
				}
				this.replyMessage(message.callbackId, null);
				break;
			}

			default:
				if (this.handler) {
					this.handler(message).then((reply: unknown) => {
						if (message.callbackId) {
							this.replyMessage(message.callbackId, reply);
						}
					});

					break;
				}

				return;
		}
	}
}
