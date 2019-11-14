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
	action?: string;

	onReady?: (data: IReadyData, api: API<unknown>) => void;
}

export interface IEnableOptions {
	origin?: string;
	features?: {[key: string]: (...args: unknown[]) => unknown};

	onReady?: (data: IReadyData, api: API<unknown>) => void;
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
 * Glue is the main Glue Javascript library entry point.
 */
export class Glue {
	public static version: string = __VERSION__;

	private window: Window;
	private origin: string;

	private initialized = false;

	private callbackCounter: number;
	private callbackTable: Map<string, ICallbackRecord>;

	private handler?: (glue: Glue, message: IPayload) => Promise<any>; /* eslint-disable-line @typescript-eslint/no-explicit-any */

	public constructor(
		{
			glueWindow,
			origin,
			handler,
		}: {
			glueWindow: Window;
			origin?: string;
			handler?: (glue: Glue, message: IPayload) => Promise<unknown>;
		}) {
		this.window = glueWindow;
		this.origin = origin ? origin : window.origin;

		this.callbackCounter = 0;
		this.callbackTable = new Map();

		this.handler = handler;

		window.addEventListener('message', this.receiveMessage, false);

		console.log('new glue', window, this.window, this.origin);
	}

	public postMessage = (type: string, data: unknown): Promise<any> => { /* eslint-disable-line @typescript-eslint/no-explicit-any */
		return new Promise((resolve, reject) => {
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
			console.debug('glue receive message from wrong source', event.source, this.window);
			return;
		}
		if (event.origin !== this.origin) {
			console.debug('glue receive message from wrong origin', event.origin, this.origin);
			return;
		}
		const message = event.data as IPayload;
		if (message.glue !== true || message.v === undefined || message.type === undefined) {
			console.debug('glue receive message not glue payload', event.data);
			return;
		}

		this.handleMessage(message);
	}

	public callFeature = async (action: string, args: unknown[]): Promise<unknown> => {
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
				if (this.initialized) {
					throw new Error('glue is already initialized');
				}

				const data = message.data as IInitData;
				if (!message.callbackId) {
					throw new Error('glue init has no callbackId');
				}

				this.initialized = true;
				console.log('glue initialized', data.features);
				// TODO(longsleep): Initialize features.

				if (!this.handler) {
					return;
				}
				this.handler(this, message).then((reply: IInitData) => {
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
					this.handler(this, message).then((reply: unknown) => {
						this.replyMessage(message.callbackId as string, reply);
					});
				}

				break;
			}

			default:
				if (this.handler) {
					this.handler(this, message).then((reply: unknown) => {
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
