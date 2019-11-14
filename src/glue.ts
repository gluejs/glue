/*!
 * Copyright 2019 Kopano and its contributors
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 * @author   Kopano <https://kopano.com>
 * @license  MIT
 * @preserve
 */

'use strict';

import {
	getOriginFromUrl,
	queueMicroTask,
} from './utils';

export const API_VERSION = 0;

export interface IEmbeddOptions {
	className?: string
	attributes?: {[key: string]: any}
	origin?: string
	features?: {[key: string]: (...args: any[]) => any}
	action?: string

	onReady?: (data: IReadyData, api: API<any>) => void
}

export interface IEnableOptions {
	origin?: string
	features?: {[key: string]: (...args: any[]) => any}

	onReady?: (data: IReadyData, api: API<any>) => void
}

export interface IPayload {
	v: number
	glue: boolean
	type: string
	data: any
	callbackId?: string
}

export interface IInitData {
	features?: Array<string>
	action?: string
}

export interface ICallbackData {
	callbackId: string
	data: any
	error?: boolean
}

export interface IReadyData {
	ready: boolean
	data?: any
	error?: boolean
}

export interface ICallData {
	action: string,
	args?: Array<any>
}

export interface ICallbackRecord {
	resolve: (value?: any) => void
	reject: (reason?: any) => void
}

export type API<T> = {
	[P in keyof T]?: T[P]
}

/**
 * Embeds the provided url into the provided container by creating an iframe
 * which gets appended as child to the provided container.
 *
 * @param url URL of the app to be embedded with Glue.
 * @param container DOM node where the iframe element is appended as child.
 * @param options Embedded options.
 */
export async function embed(url: string, container: Element, options?: IEmbeddOptions): Promise<Glue> {
	const ownerDocument = container.ownerDocument !== null ? container.ownerDocument : document;

	const frame = ownerDocument.createElement('iframe');
	if (options && options.className) {
		frame.className = options.className;
	}
	if (options && options.attributes) {
		Object.entries(options.attributes).forEach(([key, value]) => {
			frame.setAttribute(key, value);
		});
	}
	frame.setAttribute('src', url);
	container.appendChild(frame);

	if (!frame.contentWindow) {
		throw new Error('new frame has no contentWindow');
	}

	const origin = options && options.origin ? options.origin : getOriginFromUrl(url);
	const features = options ? options.features : {};
	const state: {features?: Array<string>} = {};
	return new Glue({
		glueWindow: frame.contentWindow,
		origin,
		handler: async (glue: Glue, message: IPayload): Promise<any> => {
			switch (message.type) {
				case 'init': {
					const data = message.data as IInitData;
					const reply: IInitData = {
						features: features ? Object.keys(features) : [],
					};
					if (options && options.action) {
						if (data.features && data.features.includes(options.action)) {
							reply.action = options.action;
						} else {
							console.warn(`glue embed with unsupported action: ${options.action}`);
						}
					}
					state.features = data.features;
					return reply;
				}

				case 'ready':
					if (options && options.onReady) {
						const api = {} as API<{[key: string]: (...args: any[]) => Promise<any>}>;
						if (state.features) {
							state.features.forEach(action => {
								api[action] = (...args: any[]): Promise<any> => {
									return glue.callFeature(action, args);
								}
							});
						}
						options.onReady(message.data, api);
					}
					break;

				case 'call': {
					const data = message.data as ICallData;
					const handler = features ? features[data.action] : null;
					if (!handler) {
						throw new Error(`unknown action: ${data.action}`);
					}
					const args = data.args ? data.args : [];
					return handler(...args);
				}

				default:
					console.debug(`glue (embed) unknown message type: ${message.type}`);
			}
		},
	});
}

/**
 * Enables glue for the provided sourceWindow with options.
 *
 * @param sourceWindow Window element of the app which is using Glue embed.
 * @param options Enable options.
 */
export async function enable(sourceWindow?: Window, options?: IEnableOptions): Promise<Glue> {
	if (!sourceWindow) {
		sourceWindow = window.parent;
	}

	const glue = new Glue({
		glueWindow: sourceWindow,
		origin: options ? options.origin : undefined,
		handler: async (glue: Glue, message: IPayload): Promise<any> => {
			switch (message.type) {
				case 'call': {
					const data = message.data as ICallData;
					const handler = features ? features[data.action] : null;
					if (!handler) {
						throw new Error(`unknown action: ${data.action}`);
					}
					const args = data.args ? data.args : [];
					return handler(...args);
				}

				default:
					console.debug(`glue (enable) unknown message type: ${message.type}`)
			}
		},
	})
	const features = options ? options.features : {};
	queueMicroTask(() => {
		const request: IInitData = {
			features: features ? Object.keys(features) : [],
		}
		glue.postMessage('init', request).then(async (initData: IInitData): Promise<void> => {
			const ready: IReadyData = {
				ready: true,
			}
			if (initData.action) {
				// Trigger action, this action is set when initializing and it
				// is triggered before the app reports ready.
				if (features && features[initData.action])  {
					const handler = features[initData.action];
					try {
						const result = await handler();
						if (result !== undefined) {
							ready.data = result;
						}
					} catch(e) {
						ready.ready = false;
						ready.error = true;
						ready.data = e;
					}
				} else {
					ready.ready = false;
					ready.error = true;
					ready.data = new Error(`unknown glue action: ${initData.action}`);
				}
			}
			glue.postMessage('ready', ready).then((): void => {
				if (options && options.onReady) {
					const ready: IReadyData = {
						ready: true,
					}
					const api = {} as API<{[key: string]: (...args: any[]) => Promise<any>}>;
					if (initData.features) {
						for (const action of initData.features) {
							api[action] = (...args: any[]): Promise<any> => {
								return glue.callFeature(action, args);
							}
						}
					}
					options.onReady(ready, api);
				}
			});
		}).catch((reason: any)=> {
			throw new Error(`glue init failed: %{reason}`);
		});
	});

	return glue;
}

/**
 * Glue is the main Glue Javascript library entry point.
 */
export class Glue {
	public static version: string = __VERSION__;

	private window: Window;
	private origin: string;
	private features?: {[key: string]: (...args: any[]) => any}

	private initialized: boolean = false;

	private callbackCounter: number;
	private callbackTable: Map<string, ICallbackRecord>;

	private handler?: (glue: Glue, message: IPayload) => Promise<any>

	public constructor(
		{
			glueWindow,
			origin,
			handler,
		} : {
			glueWindow: Window,
			origin?: string,
			handler?: (glue: Glue, message: IPayload) => Promise<any>,
		}) {
		this.window = glueWindow;
		this.origin = origin ? origin : window.origin;

		this.callbackCounter = 0;
		this.callbackTable = new Map();

		this.handler = handler;

		window.addEventListener('message', this.receiveMessage, false);

		console.log('new glue', window, this.window, this.origin);
	}

	public postMessage = (type: string, data: any): Promise<any> => {
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

	public callFeature = async (action: string, args: any[]): Promise<any> => {
		/*const handler = this.features ? this.features[action] : null;
		if (!handler) {
			throw new Error(`unknown glue action: ${action}`);
		}

		return handler(...args);
		*/
		const message: ICallData = {
			action,
			args,
		};
		return this.postMessage('call', message);
	}

	private replyMessage = (callbackId: string, data: any): void => {
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
					this.handler(this, message).then((reply: any) => {
						this.replyMessage(message.callbackId as string, reply);
					});
				}

				break;
			}

			default:
				if (this.handler) {
					this.handler(this, message).then((reply: any) => {
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
