import Server from './Server';
import { Bindings } from 'hono/types';
import { Event } from '@cloudflare/workers-types';
import { Resend } from 'resend';

async function main() {
	Server.startServer();
}

main();

export default {
	fetch: Server.getInstance().fetch,
	scheduled: (event: Event, env: Bindings, ctx: any) => {
		ctx.waitUntil(() => {
			console.log(new Date().toISOString());
		});
	},
};
