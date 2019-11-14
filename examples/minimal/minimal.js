'use strict';

console.log('minimal.js start');

window.app = new Vue({
	el: '#app',
	data: {
		api: null,
	},
	created: function() {
		console.info('minimal.js created', this);

		this.$nextTick(async () => {
			const glue = await Glue.embed('./embedded.html', this.$refs.main, {
				className: 'app',
				action: 'embeddedFeature1',
				features: {
					minimalFeatureTest1: () => {
						console.info('minimal.js minimalFeatureTest1 feature triggered');
					},
				},
				onReady: (readyData, api) => {
					console.info('minimal.js glue is ready', readyData, api);
					this.$nextTick(() => {
						this.api = api;

						if ('someOtherThing' in api) {
							api.someOtherThing({param: 'value'});
						}
					});
				}
			});
			console.info('minimal.js created glue', glue);
		});
	},
	watch: {
		api: function(api) {
			console.info('minimal.js api has hanged', api);
			if ('someOtherThing' in api) {
				api.someOtherThing({param: 'called second time'});
			}
		}
	},
});
