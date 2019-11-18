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
	className?: string;
	attributes?: {[key: string]: string};
	origin?: string;
	features?: {[key: string]: (...args: unknown[]) => unknown};

	onBeforeInit?: (api: API<{[key: string]: (...args: unknown[]) => Promise<any>}>, cont: Promise<unknown>) => string | undefined; /* eslint-disable-line @typescript-eslint/no-explicit-any */
}

export interface IEnableOptions {
	origins?: Array<string>;
	features?: {[key: string]: (...args: unknown[]) => unknown};

	onBeforeReady?: (api: API<{[key: string]: (...args: unknown[]) => Promise<any>}>, readyData: IReadyData) => void; /* eslint-disable-line @typescript-eslint/no-explicit-any */
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
	action?: string;
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

export type API<T> = {
	[P in keyof T]?: T[P]
}

/**
 * Glue holds together glue applications and their API.
 */
export class Glue {
	public static version: string = __VERSION__;

	public readonly enabled: boolean = false;
	public api: API<{[key: string]: (...args: unknown[]) => Promise<any>}> /* eslint-disable-line @typescript-eslint/no-explicit-any */

	public constructor(
		{
			api,
		}: {
			api?: API<{[key: string]: (...args: unknown[]) => Promise<any>}>; /* eslint-disable-line @typescript-eslint/no-explicit-any */
		}) {
		this.enabled = api !== undefined;
		if (api === undefined) {
			api = {} as API<{[key: string]: (...args: unknown[]) => Promise<any>}>; /* eslint-disable-line @typescript-eslint/no-explicit-any */
		}
		this.api = api;
	}
}

/**
 * Controller implements the internal Glue functionality.
 */
export class Controller {
	private origin: string;

	private callbackCounter: number;
	private callbackTable: Map<string, ICallbackRecord>;

	private handler?: (message: IPayload) => Promise<any>; /* eslint-disable-line @typescript-eslint/no-explicit-any */

	private window?: Window;

	public constructor(
		{
			origin,
			handler,
		}: {
			origin: string;
			handler?: (message: IPayload) => Promise<unknown>;
		}) {
		this.origin = origin ? origin : window.origin;

		this.callbackCounter = 0;
		this.callbackTable = new Map();

		this.handler = handler;

		window.addEventListener('message', this.receiveMessage, false);
	}

	public Glue(api?: API<{[key: string]: (...args: unknown[]) => Promise<any>}>): Glue { /* eslint-disable-line @typescript-eslint/no-explicit-any */
		return new Glue({
			api,
		});
	}

	public attach(glueWindow: Window): void {
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

	public receiveMessage = (event: MessageEvent): void => {
		if (event.source !== this.window) {
			return;
		}
		if (event.origin !== this.origin) {
			return;
		}
		const message = event.data as IPayload;
		if (message.glue !== true || message.v === undefined || message.type === undefined) {
			return;
		}
		if (message.v > API_VERSION) {
			throw new Error(`glue versions incompatible: ${message.v} != ${API_VERSION}`);
		}

		this.handleMessage(message);
	}

	public callAction = async (action: string, args: unknown[]): Promise<unknown> => {
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

	private handleMessage = (message: IPayload): void => {
		switch (message.type) {
			case 'init': {
				const data = message.data as IInitData;
				if (!message.callbackId) {
					throw new Error('glue init has no callbackId');
				}

				console.debug('glue initialized', data.features);

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
