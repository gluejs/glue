'use strict';

console.log('minimal.js start');

window.app = new Vue({
	el: '#app',
	data: {
	},
	created: function() {
		console.info('minimal.js created', this);

		this.$nextTick(async () => {
			const glue = await Glue.embed('./embedded.html', this.$refs.main, {
				className: 'app',
			});
			console.log('minimaljs. created glue', glue);
		});
	},
});
