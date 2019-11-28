/* eslint-env browser, es6 */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* global Vue, Glue */

'use strict';

console.log('minimal.js start');

window.app = new Vue({
	el: '#app',
	data: {
		started: false,
		ready: false,
		glue: null,
		headerClass: 'is-info',
	},
	methods: {
		start: function() {
			console.info('example mounted', this);
			this.started = true;
			Glue.embed('./embedded.html', this.$refs.embedded, {
				options: {
					action: 'embeddedFeatureWithSmallDelay',
				},
				className: 'app',
				features: {
					toggleHeaderColor: (() => {
						const colors = ['primary', 'info', 'success', 'warning', 'danger', 'light', 'dark'];
						let idx = 1;
						return () => {
							idx++;
							if (!colors[idx]) {
								idx = 0;
							}
							console.debug('toggleHeaderColor', idx);
							this.headerClass = `is-${colors[idx]}`;
						}
					})(),
					minimalFeatureTest1: () => {
						console.info('minimalFeatureTest1 feature triggered');
					},
				},
				onBeforeInit: (glue, cont) => {
					console.log('glue onBeforeInit', glue.mode, Object.keys(glue.api));
					cont.then(result => {
						console.log('glue onInit action result', result);
					});
				}
			}).then(async glue => {
				console.info('glue complete', glue.mode, glue.enabled, glue);
				this.glue = glue;

				if ('someOtherThing' in glue.api) {
					await glue.api.someOtherThing({param: 'value'});
				}

				this.okOrCancel();
			}).catch(reason => {
				console.log('glue failed', reason);
			});
		},
		okOrCancel: function() {
			if (this.ready) {
				return;
			}
			if ('exampleOKCancelAction' in this.glue.api) {
				this.ready = true;
				this.glue.api.exampleOKCancelAction().then(result => {
					console.log('glue exampleOKCancelAction action result', result);
					this.ready = false;
				});
			}
		},
	},
});
