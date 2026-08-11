import { defineCollection, z } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';

export const collections = {
	docs: defineCollection({
		loader: docsLoader(),
		schema: docsSchema({
			extend: z.object({
				// Page metadata row (task-8 section 6): audience + scope +
				// last reviewed date. Rendered by the PageTitle override.
				audience: z
					.enum(['User', 'Developer', 'Operator', 'Contributor'])
					.optional(),
				scope: z.enum(['Hosted', 'Self-hosted', 'Both']).optional(),
				lastReviewed: z.string().optional(),
			}),
		}),
	}),
};
