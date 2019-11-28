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
	Glue,
	Controller,
	ICallData,
	IInitData,
	IEmbeddOptions,
	IEnableOptions,
	IPayload,
	IReadyData,
} from './glue';
import {
	getGlueParameter,
	queueMicroTask,
	setGlueParameter,
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
	const state: {
		hidden: boolean;

		glue?: Glue;
		beforeInitResolve?: (value?: unknown) => void;
		beforeInitReject?: (reason?: unknown) => void;

		retryTimer?: ReturnType<typeof setTimeout>;
	} = {
		hidden: false,
	};

	return new Promise((resolve, reject) => {
		// Add default option values and ensure options.
		options = {
			timeout: 5000,
			sandboxRestrictions: 'allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-same-origin',
			featurePolicy: 'animations; autoplay; camera; encrypted-media; fullscreen; geolocation; microphone; speaker; vr',
			...options,
		}

		const src = new URL(url, window.location.href);
		const origin = options.origin ? options.origin : src.origin;
		const features: {[key: string]: (...args: unknown[]) => unknown} = {
			...options.features,
		};
		const events: Set<string> = options ? options.events ? new Set(options.events) : new Set() : new Set();
		const mode = options.mode ? options.mode : '';

		// Add built in events.
		events.add('glue.visibilitychange');

		// Create glue controller.
		const controller = new Controller({
			origin,
			handler: async (message: IPayload): Promise<any> => { /* eslint-disable-line @typescript-eslint/no-explicit-any */
				switch (message.type) {
					case 'init': {
						if (state.retryTimer) {
							clearTimeout(state.retryTimer);
						}

						const data = message.data as IInitData;
						state.glue = controller.Glue({
							features: data.features,
							events: data.events,
							mode,
						});

						// Add provided features.
						const reply: IInitData = {
							features: features ? Object.keys(features) : [],
							events,
						};

						// The onBeforeInit hook allows to define or modify options for the glued app.
						if (options && options.onBeforeInit) {
							const p = new Promise((resolve, reject) => {
								state.beforeInitResolve = resolve;
								state.beforeInitReject = reject;
							});
							if (!state.beforeInitResolve || !state.beforeInitReject) {
								throw new Error('glue init promise error');
							}
							try {
								const initOptions = options.onBeforeInit(state.glue, p);
								if (initOptions) {
									reply.options = {
										...initOptions
									};
								}
							} catch (err) {
								reject(new Error(`onInit failed: ${err}`));
								return;
							}
						}
						if (!reply.options) {
							// Ensure options are set, when not set already.
							reply.options = {
								...options ? options.options : {},
							};
						}
						if (reply.options.hidden !== undefined) {
							// This allows to set the initial visibility state. At the same time the
							// value is shared early with the glued app.
							state.hidden = !!reply.options.hidden;
						} else {
							reply.options.hidden = state.hidden;
						}

						return reply;
					}

					case 'ready': {
						if (!state.glue) {
							throw new Error('failed to glue: no state');
						}

						const data = message.data as IReadyData;
						if (options && options.onBeforeInit && state.beforeInitResolve && state.beforeInitReject) {
							if (data.ready) {
								await state.beforeInitResolve(data.data);
							} else {
								await state.beforeInitReject(data.data);
							}
							delete state.beforeInitResolve;
							delete state.beforeInitReject;
							resolve(state.glue);
						} else {
							if (data.ready) {
								resolve(state.glue);
							} else {
								if (data.error) {
									throw new Error(`failed to glue: ${data.data}`)
								} else {
									reject(state.glue);
								}
							}
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
			events,
		});

		// Create iframe.
		const ownerDocument = container.ownerDocument !== null ? container.ownerDocument : document;
		const frame = ownerDocument.createElement('iframe');
		if (options && options.className) {
			frame.className = options.className;
		}
		if (options.sandboxRestrictions) {
			frame.setAttribute('sandbox', options.sandboxRestrictions);
		}
		if (options.featurePolicy) {
			frame.setAttribute('allow', options.featurePolicy);
		}
		if (options && options.attributes) {
			Object.entries(options.attributes).forEach(([key, value]) => {
				frame.setAttribute(key, value);
			});
		}

		// Prepare URL and set it to element.
		setGlueParameter(src, 'mode', mode);
		if (origin !== window.origin) {
			// Cross origin, add glue origin hash parameter to allow white list
			// checks on the other end.
			setGlueParameter(src, 'origin', window.origin);
		}

		if (options && options.onFrame) {
			options.onFrame(frame);
		}

		// Append iframe with timeout and retry.
		const append = (): void => {
			frame.setAttribute('src', src.toString());

			// Inject iframe and attach glue.
			container.appendChild(frame);
			if (!frame.contentWindow) {
				throw new Error('new frame has no contentWindow');
			}
			controller.attach(frame.contentWindow);
		}
		const retry = (): void => {
			controller.detach();
			container.removeChild(frame);
			setTimeout(() => {
				append();
			}, 1000); // NOTE(longsleep): Retry time hardcoded - is it needed to have a configuration?
		}
		frame.addEventListener('load', () => {
			if (options) {
				if (options.timeout) {
					if (state.retryTimer) {
						clearTimeout(state.retryTimer);
					}
					state.retryTimer = setTimeout(() => {
						// NOTE(longsleep): This does not detect when a reload fails.
						if (!state.glue) {
							retry();
						}
					}, options.timeout);
				} else {
					reject(new Error('glue timeout'));
				}
			}
		});
		append();
	}).then((value: unknown): Glue => {
		// Trigger final visibility state and return Glue.
		const glue = value as Glue;
		glue.hidden = state.hidden;
		return glue;
	});
}

/**
 * Enables glue for the provided sourceWindow with options.
 *
 * @param sourceWindow Window element of the app which is using Glue embed.
 * @param options Enable options.
 */
async function enable(sourceWindow?: Window, options?: IEnableOptions): Promise<Glue> {
	return new Promise((resolve, reject) => {
		if (!sourceWindow) {
			sourceWindow = window.parent;
		}

		// Get glue mode.
		const mode = getGlueParameter('mode');

		if (sourceWindow === self || mode === null) {
			// Return empty Glue API if we are self, or glue mode is not set. It
			// this means Glue is not active.
			resolve(new Glue({}));
			return;
		}

		// Add default option values and ensure options.
		options = {
			timeout: 5000,
			...options,
		};

		// Validate origin.
		const expectedOrigin = getGlueParameter('origin');
		if (expectedOrigin) {
			if (expectedOrigin !== window.origin) {
				// Validate white list if cross origin.
				if (options && options.origins) {
					if (options.origins.includes(expectedOrigin) || options.origins.includes('*')) {
						// ok
					} else {
						throw new Error('glue origin is not allowed');
					}
				}
			}
		}

		// Create glue controller.
		const features: {[key: string]: (...args: unknown[]) => unknown} = {
			...options.features,
		};
		const events = options ? options.events ? new Set(options.events): undefined : undefined;
		const controller = new Controller({
			origin: expectedOrigin ? expectedOrigin : window.origin,
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
			events,
		});

		// Attach glue.
		controller.attach(sourceWindow);

		// Start timeout.
		let failed = false;
		const timer = setTimeout(() => {
			failed = true;
			reject(new Error('glue timeout'));
		}, options.timeout);

		// Start initialization.
		queueMicroTask(() => {
			const request: IInitData = {
				features: features ? Object.keys(features) : [],
				events: events ? new Set(events) : undefined,
				mode,
			}
			controller.postMessage('init', request).then(async (initData?: IInitData): Promise<void> => {
				clearTimeout(timer);
				if (failed) {
					// Do nothing when flagged failed.
					return;
				}
				if (!initData || initData.error) {
					// TODO(longsleep): Initialization failed. What now?
					reject(new Error(`glue init received error: ${initData ? initData.error : 'no data'}`));
					return;
				}

				const readyData: IReadyData = {
					ready: true,
				}

				// Create glue.
				const glue = controller.Glue({
					features: initData.features,
					events: initData.events,
					options: initData.options,
					mode,
				});

				// Trigger onInit hook.
				if (options && options.onInit) {
					try {
						options.onInit(glue, initData);
					} catch(e) {
						readyData.ready = false;
						readyData.error = true;
						readyData.data = e;
					}
				}

				const initOptions = initData.options ? initData.options : {};

				// Trigger initial requested action.
				if (readyData.ready && initOptions.action) {
					// Trigger action, this action is set when initializing and it
					// is triggered before the app reports ready.
					if (features && features[initOptions.action as string])  {
						const handler = features[initOptions.action as string];
						try {
							const result = await handler();
							if (result !== undefined) {
								readyData.data = result;
							}
						} catch(e) {
							readyData.ready = false;
							readyData.error = true;
							readyData.data = e;
						}
					} else {
						readyData.ready = false;
						readyData.error = true;
						readyData.data = new Error(`unknown glue action: ${initOptions.action}`);
					}
				}

				// Trigger beforeReady hook.
				if (options && options.onBeforeReady) {
					try {
						options.onBeforeReady(glue, readyData);
					} catch(e) {
						readyData.ready = false;
						readyData.error = true;
						readyData.data = e;
					}
				}

				// Reply with redy result.
				controller.postMessage('ready', readyData).then((): void => {
					resolve(glue);
				});
			}).catch((reason: unknown)=> {
				throw new Error(`glue init failed: ${reason}`);
			});
		});
	});
}

export {
	Glue,
	Controller,
	embed,
	enable,
}

export default Glue;
