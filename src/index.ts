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

import {
	API,
	Glue,
	ICallData,
	IInitData,
	IEmbeddOptions,
	IEnableOptions,
	IPayload,
	IReadyData,
} from './glue';
import {
	getOriginFromUrl,
	queueMicroTask,
} from './utils';

/**
 * Embeds the provided url into the provided container by creating an iframe
 * which gets appended as child to the provided container.
 *
 * @param url URL of the app to be embedded with Glue.
 * @param container DOM node where the iframe element is appended as child.
 * @param options Embedded options.
 */
async function embed(url: string, container: Element, options?: IEmbeddOptions): Promise<Glue> {
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
	const glue = new Glue({
		glueWindow: frame.contentWindow,
		origin,
		handler: async (message: IPayload): Promise<any> => { /* eslint-disable-line @typescript-eslint/no-explicit-any */
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

				case 'ready': {
					if (options && options.onReady) {
						const api = {} as API<{[key: string]: (...args: unknown[]) => Promise<any>}>; /* eslint-disable-line @typescript-eslint/no-explicit-any */
						if (state.features) {
							state.features.forEach(action => {
								api[action] = (...args: unknown[]): Promise<any> => { /* eslint-disable-line @typescript-eslint/no-explicit-any */
									return glue.callAction(action, args);
								}
							});
						}
						const data = message.data as IReadyData;
						options.onReady(data, api);
					}
					break;
				}

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

	return glue;
}

/**
 * Enables glue for the provided sourceWindow with options.
 *
 * @param sourceWindow Window element of the app which is using Glue embed.
 * @param options Enable options.
 */
async function enable(sourceWindow?: Window, options?: IEnableOptions): Promise<Glue> {
	if (!sourceWindow) {
		sourceWindow = window.parent;
	}

	const features = options ? options.features : {};
	const glue = new Glue({
		glueWindow: sourceWindow,
		origin: options ? options.origin : undefined,
		handler: async (message: IPayload): Promise<any> => { /* eslint-disable-line @typescript-eslint/no-explicit-any */
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
					const api = {} as API<{[key: string]: (...args: unknown[]) => Promise<any>}>; /* eslint-disable-line @typescript-eslint/no-explicit-any */
					if (initData.features) {
						for (const action of initData.features) {
							api[action] = (...args: unknown[]): Promise<any> => { /* eslint-disable-line @typescript-eslint/no-explicit-any */
								return glue.callAction(action, args);
							}
						}
					}
					options.onReady(ready, api);
				}
			});
		}).catch((reason: unknown)=> {
			throw new Error(`glue init failed: ${reason}`);
		});
	});

	return glue;
}

export {
	Glue,
	embed,
	enable,
}

export default Glue;
