/* eslint-env browser */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* global Vue, Glue */

'use strict';

console.log('minimal.js start');

window.app = new Vue({
	el: '#app',
	data: {
		api: null,
	},
	mounted: function() {
		console.info('example mounted', this);
		Glue.embed('./embedded.html', this.$refs.main, {
			className: 'app',
			action: 'embeddedFeature1',
			features: {
				minimalFeatureTest1: () => {
					console.info('minimalFeatureTest1 feature triggered');
				},
			},
			onReady: (readyData, api) => {
				console.info('glue is ready', readyData, api);
				this.$nextTick(() => {
					this.api = api;

					if ('someOtherThing' in api) {
						api.someOtherThing({param: 'value'});
					}
				});
			}
		}).then(glue => {
			console.info('created glue', glue);
		});
	},
	watch: {
		api: function(api) {
			console.info('api has changed', api);
			if ('someOtherThing' in api) {
				api.someOtherThing({param: 'called second time'});
			}
		}
	},
});
